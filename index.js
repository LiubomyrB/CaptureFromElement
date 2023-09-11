
addEventListener("DOMContentLoaded", function (event){
    MediaInfo({ format: 'JSON' }, function (mediainfo) {
        main(mediainfo);
    })
});


function main(mediainfo) {
    let startButton = document.querySelector('.start-button');
    let stopButton = document.querySelector('.stop-button');
    let fileInput = document.querySelector('input[type="file"]');
    let videoPreview = document.querySelector('.original-preview');
    let canvasElement = document.querySelector('canvas');
    let context = canvasElement.getContext('2d');
    let originalInfo = document.querySelector('.original-info');
    let trackInfo = document.querySelector('.track-info');
    let trackFps = document.querySelector('.track-fps');
    let callobackFps = document.querySelector('.callback-fps');

    let defaultFile = null;

    let fpsCounter = 0;
    let frameCallbacksCounter = 0;
    let streamProcessor = null;

    startButton.addEventListener('click', function () {
        const file = fileInput.files[0] || defaultFile;
        if (file) {
            startVideoProcessor(file);
        }
    })

    stopButton.addEventListener('click', function () {
        if (streamProcessor) {
            streamProcessor.stop();
        }
    })

    fileInput.addEventListener('change', function () {
        const file = fileInput.files[0]
        if (file) {
            if (streamProcessor) {
                streamProcessor.stop();
                streamProcessor = null;
            }
            showOriginalVideoInfo(file);
        }
    });

    downloadFileByUrl('./153610.mp4').then(function (file) {
        defaultFile = file;
        showOriginalVideoInfo(file);
    }); 

    function showOriginalVideoInfo(file) {
        originalInfo.innerHTML = 'Loading...'

        const getSize = () => file.size

        const readChunk = (chunkSize, offset) =>
            new Promise((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = (event) => {
                    if (event.target.error) {
                        reject(event.target.error)
                    }
                    resolve(new Uint8Array(event.target.result))
                }
                reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize))
            })

        mediainfo
            .analyzeData(getSize, readChunk)
            .then((result) => {
                originalInfo.innerHTML = '';
                let infoArr = JSON.parse(result);
                if(!infoArr.media.track[1]) {
                    originalInfo.innerHTML = 'Cannot retrieve media info';
                    return;
                }
                for(let i in infoArr.media.track[1]) {
                    if(i == '@type') continue;
                    let row = document.createElement('DIV');
                    if(i == 'FrameRate') {
                        row.style.fontWeight = 'bold';
                    }
                    row.innerHTML = i + ': ' + infoArr.media.track[1][i];
                    originalInfo.appendChild(row);
                }
            })
            .catch((error) => {
                originalInfo.innerHTML = `An error occured:\n${error.stack}`
            })
    }

    function showTrackCapabilities(track) {
        trackInfo.innerHTML = '';
        let capabilities = track.getCapabilities();
        for(let i in capabilities) {
            let row = document.createElement('DIV');
            if(i == 'frameRate') {
                row.style.fontWeight = 'bold';
            }
            if(typeof capabilities[i] == 'object') {
                row.innerHTML = i + ': ' + JSON.stringify(capabilities[i]);
            } else {
                row.innerHTML = i + ': ' + capabilities[i];
            }
            trackInfo.appendChild(row);
        }
        
    }

    function downloadFileByUrl(url) {
        return new Promise(function (resolve, reject) {
            const xhr = new XMLHttpRequest();
            xhr.onprogress = (event) => {
                if (event.lengthComputable) {
                    //this.progress = parseInt(((event.loaded / event.total) * 100), 10);
                }
            }
            xhr.onload = (event) => {
                let file = new File([event.target.response], "file");
                resolve(file)
            }
            xhr.open('GET', url, true);
            xhr.responseType = 'blob';
            xhr.send();
        });
    }

    function startVideoProcessor(fileOrURL) {
        if (streamProcessor) {
            streamProcessor.stop();
            streamProcessor = null;
        }

        function createTrackProcessor(url) {
            let fpsUpdateInterval = null;
            videoPreview.innerHTML = '';
            var video = document.createElement('VIDEO');
            video.controls = true;
            video.autoplay = true;
            video.muted = true;
            video.loop = false;
            video.src = url;
            videoPreview.appendChild(video);

            function readFrame(now, metadata) {
                if(video.ended) return;
                frameCallbacksCounter++
                video.requestVideoFrameCallback(readFrame);
            }
            video.requestVideoFrameCallback(readFrame);

            fpsUpdateInterval = setInterval(function () {
                callobackFps.innerHTML = frameCallbacksCounter;
                trackFps.innerHTML = fpsCounter;
                fpsCounter = frameCallbacksCounter = 0;
            }, 1000)

            video.addEventListener('loadedmetadata', function (metadata) {
                canvasElement.width = video.videoWidth;
                canvasElement.height = video.videoHeight;
            });

            video.addEventListener('play', function () {
                if (streamProcessor && streamProcessor.getStatus() != 'done') {
                    streamProcessor.resume();
                } else {
                    streamProcessor = startStreamProcessor();
                }
            })
            video.addEventListener('pause', function () {
                if (!streamProcessor) return;
                streamProcessor.pause();
            })

            video.addEventListener("error", function (e) {
                console.error(e);
            });

            function startStreamProcessor() {
                let status = 'waiting';
                let stopped = false, paused = false;
                const stream = video.captureStream(60);

                const track = stream.getVideoTracks()[0];
                showTrackCapabilities(track);
                console.log('captured video track', track)
                const processor = new MediaStreamTrackProcessor({ track: track });
                let reader = processor.readable.getReader();
                status = 'active';
                readChunk();

                function readChunk() {
                    reader.read().then(async ({ done, value }) => {
                        if (value) {
                            fpsCounter++;
                            context.drawImage(value,
                                0, 0,
                                value.codedWidth, value.codedHeight);
                            value.close();
                        }

                        if (!done && !stopped) {
                            readChunk();
                        } else if (done) {
                            if (status != 'done') {
                                reader.releaseLock();
                                status = 'done';
                            }
                        }
                    });
                }

                function getMediaStream() {
                    return stream;
                }

                function pause() {
                    stopped = paused = true;
                    status = 'paused';
                }

                function resume() {
                    stopped = paused = false;
                    status = 'active';
                    readChunk(true);
                }

                function stop() {
                    stopped = true;
                    video.pause();
                    let tracks = stream.getTracks();
                    for (let t in tracks) {
                        tracks[t].stop();
                    }
                    if(fpsUpdateInterval) {
                        clearInterval(fpsUpdateInterval);
                        fpsUpdateInterval = null;
                        trackFps.innerHTML = '';
                    }
                }

                function getStatus() {
                    return status;
                }

                return {
                    getMediaStream: getMediaStream,
                    getStatus: getStatus,
                    pause: pause,
                    resume: resume,
                    stop: stop
                }
            }
        }

        if (typeof fileOrURL == 'string') {
            createTrackProcessor(fileOrURL);
        } else if (FileReader && fileOrURL) {
            let reader = new FileReader();
            reader.readAsArrayBuffer(fileOrURL);
            reader.addEventListener('load', loadHandler);
            reader.addEventListener('error', errorHandler);

            function loadHandler(e) {
                let buffer = e.target.result;
                let videoBlob = new Blob([new Uint8Array(buffer)], { type: fileOrURL.type });
                let url = window.URL.createObjectURL(videoBlob);
                createTrackProcessor(url);
            }

            function errorHandler(evt) {
                switch (evt.target.error.code) {
                    case evt.target.error.NOT_FOUND_ERR:
                        originalInfo.innerHTML = '<span style="color:#ff9f9f;">File Not Found!</span>';
                        break;
                    case evt.target.error.NOT_READABLE_ERR:
                        originalInfo.innerHTML = '<span style="color:#ff9f9f;">File is not readable</span>';
                        break;
                    case evt.target.error.ABORT_ERR:
                        break;
                    default:
                        originalInfo.innerHTML = '<span style="color:#ff9f9f;">An error occurred reading this file.</span>';
                };
            } 
        }
    };
};
