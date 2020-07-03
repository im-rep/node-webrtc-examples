'use strict';

const { createCanvas, createImageData } = require('canvas');
const { hsv } = require('color-space');
const { performance } = require('perf_hooks');

const { RTCAudioSink, RTCAudioSource, RTCVideoSink, RTCVideoSource, i420ToRgba, rgbaToI420 } = require('wrtc').nonstandard;

const width = 640;
const height = 480;

let globalFrames = {};
let globalAudioSamples = {};
let nPeers = 0;

let i420Frame = null;
let bitsPerSample = 16;
let sampleRate = 48000;
let numberOfFrames = sampleRate/100;
let channelCount = 1;
let mixedAudioSamples = new Int16Array(numberOfFrames);
const mixedAudioData = {
      samples: mixedAudioSamples,
      sampleRate: sampleRate,
      bitsPerSample: bitsPerSample,
      channelCount: channelCount,
      numberOfFrames: numberOfFrames
};

function mixAudioFrames()
{
  for (let i = 0; i < numberOfFrames; i++) {
    for (let j = 0; j < channelCount; j++) {
      mixedAudioSamples[i * channelCount + j] = 0;
      let sum = 0;
      let nAudioPeers = 0;
      for (let audioid in globalAudioSamples) {
        let audioSample = globalAudioSamples[audioid];
        if (audioSample)
          sum += audioSample[i * channelCount + j];
        nAudioPeers++;
      }
      mixedAudioSamples[i * channelCount + j] = sum;// / nAudioPeers;
    }
  }
}

function drawFrame(lastFrame,context,x,y)
{
  if (!lastFrame)
    return;
  const lastFrameCanvas = createCanvas(lastFrame.width,  lastFrame.height);
  const lastFrameContext = lastFrameCanvas.getContext('2d', { pixelFormat: 'RGBA24' });
  const rgba = new Uint8ClampedArray(lastFrame.width *  lastFrame.height * 4);
  const rgbaFrame = createImageData(rgba, lastFrame.width, lastFrame.height);
  i420ToRgba(lastFrame, rgbaFrame);
  lastFrameContext.putImageData(rgbaFrame, 0, 0);
  context.drawImage(lastFrameCanvas, x, y,width/2,height/2);
}

function makeComposite()
{
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d', { pixelFormat: 'RGBA24' });
  context.fillStyle = '#1A1723';
  context.fillRect(0, 0, width, height);
  context.font = '32px sans-serif';

  let position = 0;
  for (let frameid in globalFrames)
  {
    let x = 0;
    let y = 0;
    if (position === 1)
    {
      x = width/2;
    }
    else if (position === 2)
    {
      x = 0;
      y = height/2;
    }
    else if (position === 3)
    {
      x = width/2;
      y = height/2;
    }
    drawFrame(globalFrames[frameid],context,x,y);
    context.fillStyle = 'white';
    context.fillText(''+position,x,y+32);
    position++;
  }

  const rgbaFrame = context.getImageData(0, 0, width, height);
  const i420Frame = {
    width,
    height,
    data: new Uint8ClampedArray(1.5 * width * height)
  };
  rgbaToI420(rgbaFrame, i420Frame);
  return i420Frame;
  //source.onFrame(i420Frame);
}

setInterval(function () { i420Frame = makeComposite(); mixAudioFrames(); },10);

function beforeOffer(peerConnection) {
  console.log('beforeOffer');

  const audioTransceiver = peerConnection.addTransceiver('audio');
  const audioSink = new RTCAudioSink(audioTransceiver.receiver.track);
  const audiosource = new RTCAudioSource();
  const audiotrack = audiosource.createTrack();
  const audiotransceiver = peerConnection.addTransceiver(audiotrack);

  const source = new RTCVideoSource();
  const track = source.createTrack();
  const transceiver = peerConnection.addTransceiver(track);
  const sink = new RTCVideoSink(transceiver.receiver.track);
  console.log('new sink=',transceiver.receiver.track);

  let peerNumber = 'frame' + nPeers;
  nPeers++;
  console.log('nPeers=',Object.keys(globalFrames));
  globalFrames[peerNumber] = null;
  globalAudioSamples[peerNumber] = null;

  function onFrame({ frame }) {
    //lastFrame = frame;
    globalFrames[peerNumber] = frame;
  }

  sink.addEventListener('frame', onFrame);

  audioSink.addEventListener('data',function(d){
    //console.log('audio data from ',peerNumber,d);
    //audiosource.onData(d);
    globalAudioSamples[peerNumber] = d.samples;
  })

  const interval = setInterval(() => {
    source.onFrame(i420Frame);
    audiosource.onData(mixedAudioData);
  });

  // NOTE(mroberts): This is a hack so that we can get a callback when the
  // RTCPeerConnection is closed. In the future, we can subscribe to
  // "connectionstatechange" events.
  const { close } = peerConnection;
  peerConnection.close = function() {
    clearInterval(interval);
    delete globalFrames[peerNumber];
    sink.stop();
    audioSink.stop();
    track.stop();
    return close.apply(this, arguments);
  };
}

module.exports = { beforeOffer };
