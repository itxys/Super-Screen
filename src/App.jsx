import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [recordedChunks, setRecordedChunks] = useState([])
  const [stream, setStream] = useState(null)
  const [recordedVideo, setRecordedVideo] = useState(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [settings, setSettings] = useState({
    audioEnabled: true,
    cameraEnabled: false,
    systemAudio: true,
    microphone: true,
    autoZoom: true,
    zoomOnClick: true,
    spotlight: false,
    cursorEffect: true
  })
  const [cameraStream, setCameraStream] = useState(null)
  const [isStarting, setIsStarting] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [showZoomIndicator, setShowZoomIndicator] = useState(false)
  const [showSourcePicker, setShowSourcePicker] = useState(false)
  const [sources, setSources] = useState([])
  
  const previewCanvasRef = useRef(null)
  const renderCanvasRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const timerRef = useRef(null)
  const recordedChunksRef = useRef([])
  const cameraVideoRef = useRef(null)
  const animationFrameRef = useRef(null)
  const displayVideoRef = useRef(null)
  const canvasStreamRef = useRef(null)
  
  const mousePosRef = useRef({ x: 0, y: 0 })
  const clickEffectsRef = useRef([])
  const zoomRef = useRef({
    isZoomed: false,
    targetX: 0,
    targetY: 0,
    currentX: 0,
    currentY: 0,
    scale: 1
  })
  const zoomAnimationRef = useRef(null)
  const lastClickTimeRef = useRef(0)

  const cleanup = useCallback(() => {
    if (canvasStreamRef.current) {
      canvasStreamRef.current.getTracks().forEach(track => track.stop())
      canvasStreamRef.current = null
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop())
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }
    if (zoomAnimationRef.current) {
      cancelAnimationFrame(zoomAnimationRef.current)
    }
  }, [cameraStream])

  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  useEffect(() => {
    if (cameraStream && cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = cameraStream
    }
  }, [cameraStream])

  const getScreenSources = async () => {
    if (window.electronAPI) {
      const electronSources = await window.electronAPI.getDesktopSources()
      setSources(electronSources)
      setShowSourcePicker(true)
    } else {
      startScreenCapture()
    }
  }

  const selectSource = async (sourceId) => {
    setShowSourcePicker(false)
    await startScreenCapture(sourceId)
  }

  const startScreenCapture = async (sourceId = null) => {
    if (isStarting) return
    setIsStarting(true)

    try {
      let displayStream
      
      if (sourceId) {
        displayStream = await navigator.mediaDevices.getUserMedia({
          audio: settings.systemAudio ? {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          } : false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxWidth: 1920,
              maxHeight: 1080,
              maxFrameRate: 30
            }
          }
        })
      } else {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: 'monitor',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
          },
          audio: settings.systemAudio
        })
      }

      const video = document.createElement('video')
      video.srcObject = displayStream
      video.autoplay = true
      video.muted = true
      video.playsInline = true
      displayVideoRef.current = video

      let audioTracks = []
      if (settings.systemAudio) {
        audioTracks = displayStream.getAudioTracks()
      }

      let micAudioTracks = []
      if (settings.microphone) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
          micAudioTracks = micStream.getAudioTracks()
        } catch (err) {
          console.warn('无法获取麦克风:', err)
        }
      }

      if (settings.cameraEnabled) {
        try {
          const camStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 320 }, height: { ideal: 240 } },
            audio: false
          })
          setCameraStream(camStream)
        } catch (err) {
          console.warn('无法获取摄像头:', err)
        }
      }

      displayStream.getVideoTracks()[0].onended = () => {
        cleanup()
        if (isRecording) {
          stopRecording()
        }
        setStream(null)
        setIsRecording(false)
      }

      const canvas = renderCanvasRef.current
      const ctx = canvas.getContext('2d')
      
      const renderFrame = () => {
        if (!video.videoWidth || !video.videoHeight) {
          animationFrameRef.current = requestAnimationFrame(renderFrame)
          return
        }

        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
        }

        const { currentX, currentY, scale } = zoomRef.current
        const mousePos = mousePosRef.current
        const clicks = clickEffectsRef.current

        ctx.save()
        
        if (settings.autoZoom && !zoomRef.current.isZoomed) {
          const centerX = canvas.width / 2
          const centerY = canvas.height / 2
          ctx.translate(centerX, centerY)
          ctx.scale(scale, scale)
          ctx.translate(-mousePos.x, -mousePos.y)
        } else if (zoomRef.current.isZoomed) {
          const centerX = canvas.width / 2
          const centerY = canvas.height / 2
          ctx.translate(centerX, centerY)
          ctx.scale(scale, scale)
          ctx.translate(-currentX, -currentY)
        }

        ctx.drawImage(video, 0, 0)

        const now = Date.now()
        clickEffectsRef.current = clicks.filter(click => now - click.time < 300)
        
        if (settings.cursorEffect) {
          clickEffectsRef.current.forEach(click => {
            const timeSinceClick = now - click.time
            const progress = timeSinceClick / 300
            const radius = 10 + progress * 20
            const opacity = 1 - progress
            
            ctx.beginPath()
            ctx.arc(click.x, click.y, radius, 0, Math.PI * 2)
            ctx.strokeStyle = `rgba(0, 212, 255, ${opacity})`
            ctx.lineWidth = 3
            ctx.stroke()
          })
        }

        if (settings.spotlight && !zoomRef.current.isZoomed) {
          const gradient = ctx.createRadialGradient(
            mousePos.x, mousePos.y, 0,
            mousePos.x, mousePos.y, 250
          )
          gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
          gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.2)')
          gradient.addColorStop(1, 'rgba(0, 0, 0, 0.8)')
          
          ctx.fillStyle = gradient
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }

        ctx.restore()

        if (previewCanvasRef.current && previewCanvasRef.current.width === canvas.width) {
          const previewCtx = previewCanvasRef.current.getContext('2d')
          previewCtx.drawImage(canvas, 0, 0)
        }

        animationFrameRef.current = requestAnimationFrame(renderFrame)
      }

      video.onloadedmetadata = () => {
        renderFrame()
      }

      const canvasStream = canvas.captureStream(30)
      const allAudioTracks = [...audioTracks, ...micAudioTracks]
      allAudioTracks.forEach(track => canvasStream.addTrack(track))

      canvasStreamRef.current = canvasStream
      setStream(canvasStream)

    } catch (error) {
      console.error('获取屏幕失败:', error)
      if (error.name !== 'AbortError') {
        alert('无法启动屏幕录制: ' + error.message)
      }
    } finally {
      setIsStarting(false)
    }
  }

  const animateZoom = (targetX, targetY, targetScale, duration) => {
    if (zoomAnimationRef.current) {
      cancelAnimationFrame(zoomAnimationRef.current)
    }

    const startTime = Date.now()
    const startState = { ...zoomRef.current }
    
    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      
      const easeOut = 1 - Math.pow(1 - progress, 3)
      
      const newScale = startState.scale + (targetScale - startState.scale) * easeOut
      const newX = startState.currentX + (targetX - startState.currentX) * easeOut
      const newY = startState.currentY + (targetY - startState.currentY) * easeOut

      zoomRef.current = {
        ...zoomRef.current,
        scale: newScale,
        currentX: newX,
        currentY: newY
      }

      setZoomLevel(newScale)
      setShowZoomIndicator(newScale > 1.1)

      if (progress < 1) {
        zoomAnimationRef.current = requestAnimationFrame(animate)
      } else {
        zoomRef.current = {
          ...zoomRef.current,
          isZoomed: targetScale > 1,
          targetScale: targetScale
        }
        
        if (targetScale > 1) {
          setTimeout(() => {
            animateZoom(targetX, targetY, 1, 600)
          }, 2000)
        } else {
          setShowZoomIndicator(false)
        }
      }
    }
    
    animate()
  }

  useEffect(() => {
    const handleMouseMove = (e) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY }
    }

    const handleClick = (e) => {
      if (!settings.zoomOnClick || !stream) return
      
      const now = Date.now()
      if (now - lastClickTimeRef.current < 500) return
      lastClickTimeRef.current = now

      clickEffectsRef.current = [...clickEffectsRef.current.slice(-5), { 
        x: e.clientX, 
        y: e.clientY, 
        time: now 
      }]

      if (zoomRef.current.isZoomed) {
        zoomRef.current = {
          isZoomed: false,
          targetX: e.clientX,
          targetY: e.clientY,
          currentX: e.clientX,
          currentY: e.clientY,
          scale: 1
        }
        animateZoom(e.clientX, e.clientY, 1, 400)
      } else {
        zoomRef.current = {
          isZoomed: true,
          targetX: e.clientX,
          targetY: e.clientY,
          currentX: zoomRef.current.currentX,
          currentY: zoomRef.current.currentY,
          scale: zoomRef.current.scale
        }
        animateZoom(e.clientX, e.clientY, 2.5, 600)
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('click', handleClick)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('click', handleClick)
    }
  }, [settings.zoomOnClick, stream])

  const startRecording = useCallback(() => {
    if (!stream) {
      alert('请先选择屏幕源')
      return
    }

    recordedChunksRef.current = []
    setRecordedChunks([])

    const options = { mimeType: 'video/webm;codecs=vp9' }
    let mediaRecorder
    try {
      mediaRecorder = new MediaRecorder(stream, options)
    } catch (e) {
      mediaRecorder = new MediaRecorder(stream)
    }

    mediaRecorderRef.current = mediaRecorder

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data)
        setRecordedChunks([...recordedChunksRef.current])
      }
    }

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      setRecordedVideo(url)
    }

    mediaRecorder.start(1000)
    setIsRecording(true)

    timerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1)
    }, 1000)
  }, [stream])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }

    if (zoomAnimationRef.current) {
      cancelAnimationFrame(zoomAnimationRef.current)
    }
  }, [])

  const downloadVideo = () => {
    if (!recordedVideo) return
    
    const a = document.createElement('a')
    a.href = recordedVideo
    a.download = `super-screen-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const resetRecording = () => {
    if (recordedVideo) {
      URL.revokeObjectURL(recordedVideo)
    }
    setRecordedVideo(null)
    setRecordedChunks([])
    setRecordingTime(0)
    setZoomLevel(1)
    setShowZoomIndicator(false)
    zoomRef.current = {
      isZoomed: false,
      targetX: 0,
      targetY: 0,
      currentX: 0,
      currentY: 0,
      scale: 1
    }
    cleanup()
    setStream(null)
    setCameraStream(null)
  }

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect x="2" y="6" width="28" height="20" rx="2" stroke="#00d4ff" strokeWidth="2"/>
            <circle cx="16" cy="16" r="4" fill="#00d4ff"/>
            <circle cx="24" cy="10" r="2" fill="#ff6b6b"/>
          </svg>
          <span>Super Screen</span>
        </div>
        <div className="header-actions">
          <button 
            className={`btn ${settings.cameraEnabled ? 'btn-active' : 'btn-secondary'}`}
            onClick={() => updateSetting('cameraEnabled', !settings.cameraEnabled)}
          >
            📷 摄像头 {settings.cameraEnabled ? '开' : '关'}
          </button>
          <button 
            className={`btn ${settings.microphone ? 'btn-active' : 'btn-secondary'}`}
            onClick={() => updateSetting('microphone', !settings.microphone)}
          >
            🎤 麦克风 {settings.microphone ? '开' : '关'}
          </button>
          <button 
            className={`btn ${settings.systemAudio ? 'btn-active' : 'btn-secondary'}`}
            onClick={() => updateSetting('systemAudio', !settings.systemAudio)}
          >
            🔊 系统声音 {settings.systemAudio ? '开' : '关'}
          </button>
        </div>
      </header>

      <div className="effects-bar">
        <span className="effects-title">特效设置:</span>
        <label className="effect-toggle">
          <input 
            type="checkbox" 
            checked={settings.autoZoom}
            onChange={(e) => updateSetting('autoZoom', e.target.checked)}
          />
          <span>🎯 自动跟随</span>
        </label>
        <label className="effect-toggle">
          <input 
            type="checkbox" 
            checked={settings.zoomOnClick}
            onChange={(e) => updateSetting('zoomOnClick', e.target.checked)}
          />
          <span>🔍 点击放大</span>
        </label>
        <label className="effect-toggle">
          <input 
            type="checkbox" 
            checked={settings.spotlight}
            onChange={(e) => updateSetting('spotlight', e.target.checked)}
          />
          <span>💡 聚光灯</span>
        </label>
        <label className="effect-toggle">
          <input 
            type="checkbox" 
            checked={settings.cursorEffect}
            onChange={(e) => updateSetting('cursorEffect', e.target.checked)}
          />
          <span>👆 点击特效</span>
        </label>
      </div>

      <main className="main">
        <div className="preview-area">
          {!stream && !recordedVideo && (
            <div className="empty-state" onClick={getScreenSources}>
              <div className="empty-icon">📺</div>
              <h2>点击选择屏幕源开始录制</h2>
              <p>支持全屏、窗口或区域录制</p>
              <p className="hint">开启特效可实现鼠标跟随、点击放大、聚光灯效果</p>
            </div>
          )}
          
          {stream && !recordedVideo && (
            <div className="video-container">
              <canvas 
                ref={previewCanvasRef} 
                className="preview-video"
              />
              {cameraStream && (
                <div className="camera-overlay">
                  <video 
                    ref={cameraVideoRef}
                    autoPlay 
                    muted 
                    playsInline
                  />
                </div>
              )}
              <canvas ref={renderCanvasRef} width={1920} height={1080} style={{ display: 'none' }} />
              
              {showZoomIndicator && (
                <div className="zoom-indicator">
                  🔍 {Math.round(zoomLevel * 100)}%
                </div>
              )}
            </div>
          )}

          {recordedVideo && (
            <div className="video-container">
              <video 
                src={recordedVideo} 
                controls 
                autoPlay={false}
                className="preview-video"
              />
            </div>
          )}
        </div>

        <div className="controls-bar">
          {!stream ? (
            <button 
              className="btn btn-primary btn-large" 
              onClick={getScreenSources}
              disabled={isStarting}
            >
              {isStarting ? '请在弹窗中选择...' : '选择屏幕源'}
            </button>
          ) : (
            <>
              {!isRecording && !recordedVideo && (
                <button className="btn btn-primary btn-large" onClick={startRecording}>
                  ⏺ 开始录制
                </button>
              )}
              
              {isRecording && (
                <>
                  <div className="recording-indicator">
                    <span className="recording-dot"></span>
                    录制中 {formatTime(recordingTime)}
                  </div>
                  <button className="btn btn-danger btn-large" onClick={stopRecording}>
                    ⏹ 停止录制
                  </button>
                </>
              )}

              {recordedVideo && (
                <div className="recorded-actions">
                  <button className="btn btn-secondary" onClick={resetRecording}>
                    ↩ 重新录制
                  </button>
                  <button className="btn btn-primary btn-large" onClick={downloadVideo}>
                    💾 下载视频
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {showSourcePicker && (
        <div className="modal-overlay" onClick={() => setShowSourcePicker(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>选择屏幕源</h2>
            <div className="source-grid">
              {sources.map(source => (
                <div 
                  key={source.id} 
                  className="source-item"
                  onClick={() => selectSource(source.id)}
                >
                  <img src={source.thumbnail} alt={source.name} />
                  <span>{source.name}</span>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={() => {
              setShowSourcePicker(false)
              startScreenCapture()
            }}>
              使用浏览器选择器
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
