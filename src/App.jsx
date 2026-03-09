import React, { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react'
import './App.css'

const AppContext = createContext(null)

export function useApp() {
  return useContext(AppContext)
}

function App() {
  const [currentPage, setCurrentPage] = useState('main')
  const [recordingState, setRecordingState] = useState({
    isRecording: false,
    isPaused: false,
    duration: 0,
    sourceSelected: false
  })
  
  useEffect(() => {
    const hash = window.location.hash
    if (hash === '#/floating') {
      setCurrentPage('floating')
    }
  }, [])

  return (
    <AppContext.Provider value={{ recordingState, setRecordingState }}>
      {currentPage === 'floating' ? <FloatingControls /> : <MainWindow />}
    </AppContext.Provider>
  )
}

function FloatingControls() {
  const { recordingState, setRecordingState } = useApp()
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const handleMouseDown = (e) => {
    if (e.target.closest('.floating-controls')) return
    setIsDragging(true)
    setDragStart({ x: e.screenX, y: e.screenY })
  }

  const handleMouseMove = (e) => {
    if (!isDragging || !window.electronAPI) return
    const x = e.screenX - 140
    const y = e.screenY - 25
    window.electronAPI.moveFloatingWindow(x, y)
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  return (
    <div 
      className="floating-bar"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="floating-content">
        <div className="floating-status">
          {recordingState.isRecording ? (
            <>
              <span className="recording-dot"></span>
              <span className="time">{formatTime(recordingState.duration)}</span>
            </>
          ) : (
            <span className="idle-text">Ready</span>
          )}
        </div>
        
        <div className="floating-controls">
          {recordingState.isRecording ? (
            <>
              <button 
                className="floating-btn pause"
                title={recordingState.isPaused ? "继续" : "暂停"}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('floating-pause'))
                }}
              >
                {recordingState.isPaused ? '▶' : '⏸'}
              </button>
              <button 
                className="floating-btn stop"
                title="停止"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('floating-stop'))
                }}
              >
                ⏹
              </button>
            </>
          ) : (
            <button 
              className="floating-btn record"
              title="开始录制"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('floating-start'))
              }}
            >
              ⏺
            </button>
          )}
          
          <button 
            className="floating-btn settings"
            title="设置"
            onClick={() => window.electronAPI?.showMainWindow()}
          >
            ⚙
          </button>
        </div>
      </div>
    </div>
  )
}

function MainWindow() {
  const { recordingState, setRecordingState } = useApp()
  const [activeTab, setActiveTab] = useState('record')
  const [sources, setSources] = useState([])
  const [showSourcePicker, setShowSourcePicker] = useState(false)
  const [settings, setSettings] = useState({
    cameraEnabled: false,
    microphone: true,
    systemAudio: true,
    cameraPosition: 'bottom-right',
    cameraShape: 'rounded',
    autoZoom: true,
    zoomOnClick: true,
    spotlight: false,
    cursorEffect: true,
    showKeys: false,
    videoQuality: 'high',
    videoFormat: 'webm'
  })
  
  const [stream, setStream] = useState(null)
  const [recordedVideo, setRecordedVideo] = useState(null)
  const [recordings, setRecordings] = useState([])
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [editingVideo, setEditingVideo] = useState(null)
  const [exportSettings, setExportSettings] = useState({
    format: 'webm',
    quality: 'high',
    resolution: 'original'
  })
  
  const previewCanvasRef = useRef(null)
  const renderCanvasRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const timerRef = useRef(null)
  const recordedChunksRef = useRef([])
  const cameraVideoRef = useRef(null)
  const animationFrameRef = useRef(null)
  const displayVideoRef = useRef(null)
  const canvasStreamRef = useRef(null)
  const microphoneStreamRef = useRef(null)
  
  const mousePosRef = useRef({ x: 0, y: 0 })
  const clickEffectsRef = useRef([])
  const zoomRef = useRef({ isZoomed: false, currentX: 0, currentY: 0, scale: 1 })
  const keysPressedRef = useRef(new Set())
  const zoomAnimationRef = useRef(null)

  useEffect(() => {
    return () => cleanup()
  }, [])

  useEffect(() => {
    const handleFloatingStart = () => {
      if (!recordingState.sourceSelected) {
        getScreenSources()
      } else if (!recordingState.isRecording) {
        startRecording()
      }
    }
    const handleFloatingPause = () => pauseRecording()
    const handleFloatingStop = () => stopRecording()

    window.addEventListener('floating-start', handleFloatingStart)
    window.addEventListener('floating-pause', handleFloatingPause)
    window.addEventListener('floating-stop', handleFloatingStop)

    return () => {
      window.removeEventListener('floating-start', handleFloatingStart)
      window.removeEventListener('floating-pause', handleFloatingPause)
      window.removeEventListener('floating-stop', handleFloatingStop)
    }
  }, [recordingState])

  const cleanup = useCallback(() => {
    if (canvasStreamRef.current) {
      canvasStreamRef.current.getTracks().forEach(t => t.stop())
      canvasStreamRef.current = null
    }
    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach(t => t.stop())
      microphoneStreamRef.current = null
    }
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    if (zoomAnimationRef.current) cancelAnimationFrame(zoomAnimationRef.current)
  }, [])

  const getScreenSources = async () => {
    if (window.electronAPI) {
      const electronSources = await window.electronAPI.getDesktopSources()
      setSources(electronSources)
      setShowSourcePicker(true)
    } else {
      await startScreenCapture()
    }
  }

  const selectSource = async (sourceId) => {
    setShowSourcePicker(false)
    await startScreenCapture(sourceId)
  }

  const startScreenCapture = async (sourceId = null) => {
    try {
      let displayStream
      if (sourceId) {
        displayStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
        })
      } else {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
          audio: settings.systemAudio
        })
      }

      const video = document.createElement('video')
      video.srcObject = displayStream
      video.autoplay = true
      video.muted = true
      displayVideoRef.current = video

      let audioTracks = []
      if (settings.systemAudio) {
        audioTracks = displayStream.getAudioTracks()
      }

      let micStream = null
      if (settings.microphone) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
          microphoneStreamRef.current = micStream
        } catch (err) {
          console.warn('无法获取麦克风:', err)
        }
      }

      if (settings.cameraEnabled) {
        try {
          const camStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 320, height: 240 }
          })
          setCameraStream(camStream)
        } catch (err) {
          console.warn('无法获取摄像头:', err)
        }
      }

      displayStream.getVideoTracks()[0].onended = () => {
        if (recordingState.isRecording) stopRecording()
        cleanup()
        setStream(null)
        setRecordingState(s => ({ ...s, sourceSelected: false, isRecording: false }))
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

        ctx.save()
        
        if ((settings.autoZoom || settings.spotlight) && !zoomRef.current.isZoomed) {
          ctx.translate(canvas.width / 2, canvas.height / 2)
          ctx.scale(scale, scale)
          ctx.translate(-mousePos.x, -mousePos.y)
        } else if (zoomRef.current.isZoomed) {
          ctx.translate(canvas.width / 2, canvas.height / 2)
          ctx.scale(scale, scale)
          ctx.translate(-currentX, -currentY)
        }

        ctx.drawImage(video, 0, 0)

        const now = Date.now()
        clickEffectsRef.current = clickEffectsRef.current.filter(c => now - c.time < 300)
        
        if (settings.cursorEffect) {
          clickEffectsRef.current.forEach(click => {
            const progress = (now - click.time) / 300
            ctx.beginPath()
            ctx.arc(click.x, click.y, 10 + progress * 20, 0, Math.PI * 2)
            ctx.strokeStyle = `rgba(0, 212, 255, ${1 - progress})`
            ctx.lineWidth = 3
            ctx.stroke()
          })
        }

        if (settings.spotlight && !zoomRef.current.isZoomed) {
          const gradient = ctx.createRadialGradient(mousePos.x, mousePos.y, 0, mousePos.x, mousePos.y, 250)
          gradient.addColorStop(0, 'rgba(0,0,0,0)')
          gradient.addColorStop(0.4, 'rgba(0,0,0,0.2)')
          gradient.addColorStop(1, 'rgba(0,0,0,0.8)')
          ctx.fillStyle = gradient
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }

        if (settings.showKeys && keysPressedRef.current.size > 0) {
          drawKeysOverlay(ctx, keysPressedRef.current)
        }

        ctx.restore()

        if (previewCanvasRef.current) {
          const previewCtx = previewCanvasRef.current.getContext('2d')
          previewCtx.drawImage(canvas, 0, 0)
        }

        animationFrameRef.current = requestAnimationFrame(renderFrame)
      }

      video.onloadedmetadata = () => renderFrame()

      const canvasStream = canvas.captureStream(30)
      const allAudioTracks = [...audioTracks]
      if (micStream) allAudioTracks.push(...micStream.getAudioTracks())
      allAudioTracks.forEach(t => canvasStream.addTrack(t))

      canvasStreamRef.current = canvasStream
      setStream(canvasStream)
      setRecordingState(s => ({ ...s, sourceSelected: true }))
      updateFloatingState()

    } catch (error) {
      console.error('获取屏幕失败:', error)
    }
  }

  const [cameraStream, setCameraStream] = useState(null)

  const drawKeysOverlay = (ctx, keys) => {
    const keyArray = Array.from(keys)
    const text = keyArray.join(' + ')
    ctx.font = 'bold 24px sans-serif'
    const metrics = ctx.measureText(text)
    const padding = 12
    const x = 20
    const y = 20
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.roundRect(x, y, metrics.width + padding * 2, 40, 8)
    ctx.fill()
    
    ctx.fillStyle = '#fff'
    ctx.fillText(text, x + padding, y + 28)
  }

  const updateFloatingState = () => {
    if (window.electronAPI) {
      window.electronAPI.updateFloatingState(recordingState)
    }
  }

  useEffect(() => {
    const handleMouseMove = (e) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY }
    }

    const handleClick = (e) => {
      if (!settings.zoomOnClick || !stream) return
      
      clickEffectsRef.current = [...clickEffectsRef.current.slice(-5), { 
        x: e.clientX, y: e.clientY, time: Date.now() 
      }]

      if (zoomRef.current.isZoomed) {
        zoomRef.current = { isZoomed: false, currentX: e.clientX, currentY: e.clientY, scale: 1 }
        animateZoom(e.clientX, e.clientY, 1, 400)
      } else {
        zoomRef.current = { isZoomed: true, ...zoomRef.current }
        animateZoom(e.clientX, e.clientY, 2.5, 600)
      }
    }

    const handleKeyDown = (e) => {
      if (settings.showKeys) {
        keysPressedRef.current.add(e.key.toUpperCase())
      }
    }

    const handleKeyUp = (e) => {
      keysPressedRef.current.delete(e.key.toUpperCase())
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('click', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [settings.zoomOnClick, stream, settings.showKeys])

  const animateZoom = (targetX, targetY, targetScale, duration) => {
    const startTime = Date.now()
    const startState = { ...zoomRef.current }
    
    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easeOut = 1 - Math.pow(1 - progress, 3)
      
      zoomRef.current = {
        ...zoomRef.current,
        scale: startState.scale + (targetScale - startState.scale) * easeOut,
        currentX: startState.currentX + (targetX - startState.currentX) * easeOut,
        currentY: startState.currentY + (targetY - startState.currentY) * easeOut
      }

      if (progress < 1) {
        zoomAnimationRef.current = requestAnimationFrame(animate)
      } else {
        zoomRef.current.isZoomed = targetScale > 1
        if (targetScale > 1) {
          setTimeout(() => animateZoom(targetX, targetY, 1, 600), 2000)
        }
      }
    }
    animate()
  }

  const startRecording = useCallback(() => {
    if (!stream) return

    recordedChunksRef.current = []
    
    let mimeType = 'video/webm;codecs=vp9'
    if (settings.videoFormat === 'mp4') {
      mimeType = 'video/mp4'
    }
    
    try {
      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType })
    } catch (e) {
      mediaRecorderRef.current = new MediaRecorder(stream)
    }

    mediaRecorderRef.current.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data)
    }

    mediaRecorderRef.current.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: mediaRecorderRef.current.mimeType })
      const url = URL.createObjectURL(blob)
      const newRecording = {
        id: Date.now(),
        url,
        duration: recordingDuration,
        date: new Date().toLocaleString(),
        format: settings.videoFormat
      }
      setRecordings(prev => [newRecording, ...prev])
      setRecordedVideo(url)
    }

    mediaRecorderRef.current.start(1000)
    setRecordingState(s => ({ ...s, isRecording: true, isPaused: false, duration: 0 }))
    
    timerRef.current = setInterval(() => {
      setRecordingDuration(d => {
        const newDuration = d + 1
        setRecordingState(s => ({ ...s, duration: newDuration }))
        return newDuration
      })
    }, 1000)
    
    updateFloatingState()
  }, [stream, settings.videoFormat, recordingDuration])

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause()
      clearInterval(timerRef.current)
      setRecordingState(s => ({ ...s, isPaused: true }))
    } else if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume()
      timerRef.current = setInterval(() => {
        setRecordingDuration(d => {
          const newDuration = d + 1
          setRecordingState(s => ({ ...s, duration: newDuration }))
          return newDuration
        })
      }, 1000)
      setRecordingState(s => ({ ...s, isPaused: false }))
    }
    updateFloatingState()
  }

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    clearInterval(timerRef.current)
    setRecordingState(s => ({ ...s, isRecording: false, isPaused: false }))
    updateFloatingState()
  }, [])

  const exportVideo = async (recording, options) => {
    const { format, quality, resolution } = options
    
    const video = document.createElement('video')
    video.src = recording.url
    await new Promise(resolve => video.onloadedmetadata = resolve)

    const canvas = document.createElement('canvas')
    let width = video.videoWidth
    let height = video.videoHeight

    if (resolution === '1080p') {
      height = 1080
      width = Math.round(1920 * (height / video.videoHeight))
    } else if (resolution === '720p') {
      height = 720
      width = Math.round(1920 * (height / video.videoHeight))
    } else if (resolution === '480p') {
      height = 480
      width = Math.round(1920 * (height / video.videoHeight))
    }

    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, width, height)

    const mimeType = format === 'mp4' ? 'video/mp4' : 'video/webm'
    const exportStream = canvas.captureStream(30)
    
    const finalBlob = await new Promise(resolve => {
      const exportRecorder = new MediaRecorder(exportStream, { mimeType })
      const chunks = []
      exportRecorder.ondataavailable = e => chunks.push(e.data)
      exportRecorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
      exportRecorder.start()
      
      video.currentTime = 0
      video.play()
      
      const drawFrame = () => {
        if (video.currentTime < video.duration) {
          ctx.drawImage(video, 0, 0, width, height)
          requestAnimationFrame(drawFrame)
        } else {
          exportRecorder.stop()
          video.pause()
        }
      }
      drawFrame()
    })

    const url = URL.createObjectURL(finalBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `super-screen-export-${Date.now()}.${format}`
    a.click()
  }

  const downloadVideo = (url, format = 'webm') => {
    const a = document.createElement('a')
    a.href = url
    a.download = `super-screen-${Date.now()}.${format}`
    a.click()
  }

  const deleteRecording = (id) => {
    setRecordings(prev => prev.filter(r => r.id !== id))
  }

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <rect x="2" y="6" width="28" height="20" rx="2" stroke="#00d4ff" strokeWidth="2"/>
            <circle cx="16" cy="16" r="4" fill="#00d4ff"/>
            <circle cx="24" cy="10" r="2" fill="#ff6b6b"/>
          </svg>
          <span>Super Screen</span>
        </div>
        <nav className="tabs">
          <button className={activeTab === 'record' ? 'active' : ''} onClick={() => setActiveTab('record')}>录制</button>
          <button className={activeTab === 'files' ? 'active' : ''} onClick={() => setActiveTab('files')}>文件</button>
          <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>设置</button>
        </nav>
      </header>

      <main className="main">
        {activeTab === 'record' && (
          <div className="record-page">
            <div className="preview-section">
              {!recordingState.sourceSelected ? (
                <div className="empty-state" onClick={getScreenSources}>
                  <div className="empty-icon">📺</div>
                  <h3>点击选择屏幕源</h3>
                  <p>支持全屏、窗口录制</p>
                </div>
              ) : (
                <div className="video-container">
                  <canvas ref={previewCanvasRef} className="preview-video" />
                  {cameraStream && (
                    <div className={`camera-overlay ${settings.cameraPosition} ${settings.cameraShape}`}>
                      <video ref={cameraVideoRef} autoPlay muted playsInline />
                    </div>
                  )}
                  <canvas ref={renderCanvasRef} style={{ display: 'none' }} />
                </div>
              )}
            </div>

            <div className="controls-section">
              {!recordingState.sourceSelected ? (
                <button className="btn btn-primary btn-large" onClick={getScreenSources}>
                  选择屏幕源
                </button>
              ) : !recordingState.isRecording ? (
                <button className="btn btn-primary btn-large" onClick={startRecording}>
                  ⏺ 开始录制
                </button>
              ) : (
                <div className="recording-controls">
                  <div className="recording-info">
                    <span className="recording-dot"></span>
                    <span className="time">{formatTime(recordingState.duration)}</span>
                    {recordingState.isPaused && <span className="paused-label">已暂停</span>}
                  </div>
                  <div className="recording-buttons">
                    <button className="btn btn-secondary" onClick={pauseRecording}>
                      {recordingState.isPaused ? '▶ 继续' : '⏸ 暂停'}
                    </button>
                    <button className="btn btn-danger" onClick={stopRecording}>
                      ⏹ 停止
                    </button>
                  </div>
                </div>
              )}

              {recordedVideo && (
                <div className="recorded-result">
                  <video src={recordedVideo} controls />
                  <button className="btn btn-primary" onClick={() => downloadVideo(recordedVideo, settings.videoFormat)}>
                    💾 下载
                  </button>
                  <button className="btn btn-secondary" onClick={() => setRecordedVideo(null)}>
                    关闭
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'files' && (
          <div className="files-page">
            <h3>录制文件</h3>
            {recordings.length === 0 ? (
              <div className="empty-files">暂无录制文件</div>
            ) : (
              <div className="recordings-list">
                {recordings.map(rec => (
                  <div key={rec.id} className="recording-item">
                    <video src={rec.url} />
                    <div className="recording-info">
                      <span>{formatTime(rec.duration)}</span>
                      <span>{rec.date}</span>
                      <span className="format-tag">{rec.format}</span>
                    </div>
                    <div className="recording-actions">
                      <button className="btn btn-primary btn-sm" onClick={() => downloadVideo(rec.url, rec.format)}>
                        下载
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditingVideo(rec)}>
                        导出
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteRecording(rec.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="settings-page">
            <h3>录制设置</h3>
            
            <div className="settings-group">
              <h4>输出格式</h4>
              <label className="select-item">
                <span>视频格式</span>
                <select value={settings.videoFormat} onChange={e => updateSetting('videoFormat', e.target.value)}>
                  <option value="webm">WebM (推荐)</option>
                  <option value="mp4">MP4</option>
                </select>
              </label>
              <label className="select-item">
                <span>视频质量</span>
                <select value={settings.videoQuality} onChange={e => updateSetting('videoQuality', e.target.value)}>
                  <option value="high">高清 (1080p)</option>
                  <option value="medium">标清 (720p)</option>
                  <option value="low">流畅 (480p)</option>
                </select>
              </label>
            </div>

            <div className="settings-group">
              <h4>音频</h4>
              <label className="toggle-item">
                <span>🎤 麦克风</span>
                <input type="checkbox" checked={settings.microphone} onChange={e => updateSetting('microphone', e.target.checked)} />
              </label>
              <label className="toggle-item">
                <span>🔊 系统声音</span>
                <input type="checkbox" checked={settings.systemAudio} onChange={e => updateSetting('systemAudio', e.target.checked)} />
              </label>
            </div>

            <div className="settings-group">
              <h4>摄像头</h4>
              <label className="toggle-item">
                <span>📷 启用摄像头</span>
                <input type="checkbox" checked={settings.cameraEnabled} onChange={e => updateSetting('cameraEnabled', e.target.checked)} />
              </label>
              {settings.cameraEnabled && (
                <>
                  <label className="select-item">
                    <span>位置</span>
                    <select value={settings.cameraPosition} onChange={e => updateSetting('cameraPosition', e.target.value)}>
                      <option value="bottom-right">右下角</option>
                      <option value="bottom-left">左下角</option>
                      <option value="top-right">右上角</option>
                      <option value="top-left">左上角</option>
                    </select>
                  </label>
                  <label className="select-item">
                    <span>形状</span>
                    <select value={settings.cameraShape} onChange={e => updateSetting('cameraShape', e.target.value)}>
                      <option value="rounded">圆角</option>
                      <option value="circle">圆形</option>
                      <option value="square">方形</option>
                    </select>
                  </label>
                </>
              )}
            </div>

            <div className="settings-group">
              <h4>特效</h4>
              <label className="toggle-item">
                <span>🎯 自动跟随鼠标</span>
                <input type="checkbox" checked={settings.autoZoom} onChange={e => updateSetting('autoZoom', e.target.checked)} />
              </label>
              <label className="toggle-item">
                <span>🔍 点击放大</span>
                <input type="checkbox" checked={settings.zoomOnClick} onChange={e => updateSetting('zoomOnClick', e.target.checked)} />
              </label>
              <label className="toggle-item">
                <span>💡 聚光灯</span>
                <input type="checkbox" checked={settings.spotlight} onChange={e => updateSetting('spotlight', e.target.checked)} />
              </label>
              <label className="toggle-item">
                <span>👆 点击特效</span>
                <input type="checkbox" checked={settings.cursorEffect} onChange={e => updateSetting('cursorEffect', e.target.checked)} />
              </label>
              <label className="toggle-item">
                <span>⌨️ 显示快捷键</span>
                <input type="checkbox" checked={settings.showKeys} onChange={e => updateSetting('showKeys', e.target.checked)} />
              </label>
            </div>
          </div>
        )}
      </main>

      {showSourcePicker && (
        <div className="modal-overlay" onClick={() => setShowSourcePicker(false)}>
          <div className="modal source-picker" onClick={e => e.stopPropagation()}>
            <h2>选择屏幕源</h2>
            <div className="source-grid">
              {sources.map(source => (
                <div key={source.id} className="source-item" onClick={() => selectSource(source.id)}>
                  <img src={source.thumbnail} alt={source.name} />
                  <span>{source.name}</span>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={() => { setShowSourcePicker(false); startScreenCapture() }}>
              使用浏览器选择器
            </button>
          </div>
        </div>
      )}

      {editingVideo && (
        <div className="modal-overlay" onClick={() => setEditingVideo(null)}>
          <div className="modal export-modal" onClick={e => e.stopPropagation()}>
            <h2>导出视频</h2>
            <div className="export-options">
              <label className="select-item">
                <span>格式</span>
                <select value={exportSettings.format} onChange={e => setExportSettings(s => ({ ...s, format: e.target.value }))}>
                  <option value="webm">WebM</option>
                  <option value="mp4">MP4</option>
                </select>
              </label>
              <label className="select-item">
                <span>分辨率</span>
                <select value={exportSettings.resolution} onChange={e => setExportSettings(s => ({ ...s, resolution: e.target.value }))}>
                  <option value="original">原始</option>
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                  <option value="480p">480p</option>
                </select>
              </label>
              <label className="select-item">
                <span>质量</span>
                <select value={exportSettings.quality} onChange={e => setExportSettings(s => ({ ...s, quality: e.target.value }))}>
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </label>
            </div>
            <div className="export-preview">
              <video src={editingVideo.url} controls />
            </div>
            <div className="export-actions">
              <button className="btn btn-secondary" onClick={() => setEditingVideo(null)}>取消</button>
              <button className="btn btn-primary" onClick={() => exportVideo(editingVideo, exportSettings)}>
                导出视频
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
