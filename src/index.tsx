import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { GoogleGenAI } from '@google/genai'

const app = new Hono()

// CORS 설정
app.use('/api/*', cors())

// 정적 파일 서빙
app.use('/static/*', serveStatic({ root: './public' }))

// Google Gemini TTS API
app.post('/api/tts', async (c) => {
  try {
    const { text, voice = 'Kore', language = 'ko-KR' } = await c.req.json()
    
    if (!text) {
      return c.json({ error: '텍스트를 입력해주세요.' }, 400)
    }

    // 음성 매핑
    const voiceMap: Record<string, string> = {
      'ko-KR-Standard-A': 'Kore',
      'ko-KR-Standard-B': 'Aoede',
      'ko-KR-Standard-C': 'Charon',
      'ko-KR-Standard-D': 'Puck',
      'en-US-Standard-A': 'Puck',
      'en-US-Standard-C': 'Aoede',
      'ja-JP-Standard-A': 'Kore',
      'ja-JP-Standard-C': 'Charon',
      'zh-CN-Standard-A': 'Kore',
      'zh-CN-Standard-C': 'Puck',
    }

    const selectedVoice = voiceMap[voice] || 'Kore'
    const apiKey = 'AIzaSyDniM_v_rTlDWEzB-rTnUq5_H-Ci12XrIw'

    // Google GenAI 초기화
    const ai = new GoogleGenAI({ apiKey })

    // TTS 생성 요청
    // 중요: Gemini TTS 모델은 반드시 "Say", "Read" 같은 명령어가 필요
    // 그렇지 않으면 텍스트를 생성하려고 시도함
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ 
        parts: [{ 
          text: `Read this: ${text}`
        }] 
      }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: selectedVoice
            }
          }
        }
      }
    })

    // 오디오 데이터 추출
    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
    
    if (audioData) {
      // Gemini는 원시 PCM 데이터를 반환하므로 WAV 헤더를 추가해야 함
      // Google 예제에서는 wav 패키지를 사용하지만, 여기서는 수동으로 헤더 생성
      
      // Base64 디코딩
      const pcmData = Buffer.from(audioData, 'base64')
      
      // WAV 헤더 생성 (24kHz, 16-bit, mono)
      const sampleRate = 24000
      const numChannels = 1
      const bitsPerSample = 16
      const dataSize = pcmData.length
      const wavHeader = Buffer.alloc(44)
      
      // RIFF 청크
      wavHeader.write('RIFF', 0)
      wavHeader.writeUInt32LE(36 + dataSize, 4)
      wavHeader.write('WAVE', 8)
      
      // fmt 청크
      wavHeader.write('fmt ', 12)
      wavHeader.writeUInt32LE(16, 16) // fmt 청크 크기
      wavHeader.writeUInt16LE(1, 20) // 오디오 포맷 (1 = PCM)
      wavHeader.writeUInt16LE(numChannels, 22) // 채널 수
      wavHeader.writeUInt32LE(sampleRate, 24) // 샘플레이트
      wavHeader.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28) // 바이트레이트
      wavHeader.writeUInt16LE(numChannels * bitsPerSample / 8, 32) // 블록 정렬
      wavHeader.writeUInt16LE(bitsPerSample, 34) // 비트 깊이
      
      // data 청크
      wavHeader.write('data', 36)
      wavHeader.writeUInt32LE(dataSize, 40)
      
      // WAV 헤더 + PCM 데이터 결합
      const wavFile = Buffer.concat([wavHeader, pcmData])
      const wavBase64 = wavFile.toString('base64')
      
      return c.json({
        success: true,
        audio: wavBase64,
        mimeType: 'audio/wav'
      })
    }

    return c.json({ error: '오디오 데이터를 찾을 수 없습니다.' }, 500)

  } catch (error: any) {
    console.error('TTS Error:', error)
    return c.json({ 
      error: 'TTS 생성 중 오류가 발생했습니다.', 
      details: error.message 
    }, 500)
  }
})

// 메인 페이지
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Gemini TTS 음성 생성기</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen p-8">
        <div class="max-w-4xl mx-auto">
            <!-- 헤더 -->
            <div class="text-center mb-8">
                <h1 class="text-4xl font-bold text-gray-800 mb-2">
                    <i class="fas fa-microphone-alt text-indigo-600 mr-3"></i>
                    Gemini TTS 음성 생성기
                </h1>
                <p class="text-gray-600">텍스트를 입력하고 고품질 음성으로 변환하세요</p>
            </div>

            <!-- 메인 카드 -->
            <div class="bg-white rounded-2xl shadow-xl p-8 mb-6">
                <!-- 텍스트 입력 영역 -->
                <div class="mb-6">
                    <label class="block text-gray-700 font-semibold mb-2">
                        <i class="fas fa-edit mr-2"></i>스크립트 입력
                    </label>
                    <textarea 
                        id="scriptInput" 
                        class="w-full p-4 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none resize-none transition"
                        rows="8"
                        placeholder="여기에 음성으로 변환할 텍스트를 입력하세요...&#10;&#10;예시: 안녕하세요. Gemini TTS를 사용한 음성 생성 시스템입니다."
                    ></textarea>
                    <div class="text-right text-sm text-gray-500 mt-1">
                        <span id="charCount">0</span> 글자
                    </div>
                </div>

                <!-- 음성 설정 -->
                <div class="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">
                            <i class="fas fa-user mr-2"></i>음성 선택
                        </label>
                        <select 
                            id="voiceSelect" 
                            class="w-full p-3 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                        >
                            <option value="ko-KR-Standard-A" selected>Kore (여성)</option>
                            <option value="ko-KR-Standard-B">Aoede (여성)</option>
                            <option value="ko-KR-Standard-C">Charon (남성)</option>
                            <option value="ko-KR-Standard-D">Puck (남성)</option>
                            <option value="en-US-Standard-A">Puck (영어 남성)</option>
                            <option value="en-US-Standard-C">Aoede (영어 여성)</option>
                            <option value="ja-JP-Standard-A">Kore (일본어 여성)</option>
                            <option value="ja-JP-Standard-C">Charon (일본어 남성)</option>
                            <option value="zh-CN-Standard-A">Kore (중국어 여성)</option>
                            <option value="zh-CN-Standard-C">Puck (중국어 남성)</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-gray-700 font-semibold mb-2">
                            <i class="fas fa-language mr-2"></i>언어
                        </label>
                        <select 
                            id="languageSelect" 
                            class="w-full p-3 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                        >
                            <option value="ko-KR" selected>한국어</option>
                            <option value="en-US">English</option>
                            <option value="ja-JP">日本語</option>
                            <option value="zh-CN">中文</option>
                        </select>
                    </div>
                </div>

                <!-- 생성 버튼 -->
                <button 
                    id="generateBtn" 
                    class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-6 rounded-lg transition duration-200 transform hover:scale-105 active:scale-95 shadow-lg"
                >
                    <i class="fas fa-magic mr-2"></i>음성 생성하기
                </button>

                <!-- 로딩 표시 -->
                <div id="loading" class="hidden mt-6 text-center">
                    <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-4 border-indigo-600"></div>
                    <p class="text-gray-600 mt-3">음성을 생성하는 중...</p>
                </div>

                <!-- 에러 메시지 -->
                <div id="errorMsg" class="hidden mt-6 p-4 bg-red-100 border-l-4 border-red-500 text-red-700 rounded">
                    <i class="fas fa-exclamation-triangle mr-2"></i>
                    <span id="errorText"></span>
                </div>
            </div>

            <!-- 오디오 플레이어 -->
            <div id="audioPlayer" class="hidden bg-white rounded-2xl shadow-xl p-8">
                <h2 class="text-2xl font-bold text-gray-800 mb-4">
                    <i class="fas fa-headphones text-indigo-600 mr-2"></i>생성된 음성
                </h2>
                <audio id="audioElement" controls class="w-full mb-4"></audio>
                <div class="flex gap-4">
                    <button 
                        id="downloadBtn" 
                        class="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition"
                    >
                        <i class="fas fa-download mr-2"></i>다운로드
                    </button>
                    <button 
                        id="newBtn" 
                        class="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg transition"
                    >
                        <i class="fas fa-plus mr-2"></i>새로 만들기
                    </button>
                </div>
            </div>

            <!-- 사용 안내 -->
            <div class="mt-8 bg-white rounded-2xl shadow-xl p-6">
                <h3 class="text-lg font-bold text-gray-800 mb-3">
                    <i class="fas fa-info-circle text-blue-600 mr-2"></i>사용 방법
                </h3>
                <ul class="text-gray-600 space-y-2">
                    <li><i class="fas fa-check text-green-500 mr-2"></i>텍스트를 입력하세요</li>
                    <li><i class="fas fa-check text-green-500 mr-2"></i>원하는 음성과 언어를 선택하세요</li>
                    <li><i class="fas fa-check text-green-500 mr-2"></i>"음성 생성하기" 버튼을 클릭하세요</li>
                    <li><i class="fas fa-check text-green-500 mr-2"></i>생성된 음성을 재생하거나 다운로드하세요</li>
                </ul>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            const scriptInput = document.getElementById('scriptInput');
            const charCount = document.getElementById('charCount');
            const voiceSelect = document.getElementById('voiceSelect');
            const languageSelect = document.getElementById('languageSelect');
            const generateBtn = document.getElementById('generateBtn');
            const loading = document.getElementById('loading');
            const errorMsg = document.getElementById('errorMsg');
            const errorText = document.getElementById('errorText');
            const audioPlayer = document.getElementById('audioPlayer');
            const audioElement = document.getElementById('audioElement');
            const downloadBtn = document.getElementById('downloadBtn');
            const newBtn = document.getElementById('newBtn');

            let currentAudioUrl = null;
            let currentAudioData = null;

            // 글자 수 카운트
            scriptInput.addEventListener('input', () => {
                charCount.textContent = scriptInput.value.length;
            });

            // 음성 생성
            generateBtn.addEventListener('click', async () => {
                const text = scriptInput.value.trim();
                
                if (!text) {
                    showError('텍스트를 입력해주세요.');
                    return;
                }

                // UI 업데이트
                generateBtn.disabled = true;
                loading.classList.remove('hidden');
                errorMsg.classList.add('hidden');
                audioPlayer.classList.add('hidden');

                try {
                    const response = await axios.post('/api/tts', {
                        text: text,
                        voice: voiceSelect.value,
                        language: languageSelect.value
                    });

                    if (response.data.success && response.data.audio) {
                        currentAudioData = response.data.audio;
                        
                        // Base64를 Blob으로 변환
                        const binaryString = atob(currentAudioData);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        const blob = new Blob([bytes], { type: 'audio/wav' });
                        currentAudioUrl = URL.createObjectURL(blob);
                        
                        // 오디오 플레이어 표시
                        audioElement.src = currentAudioUrl;
                        audioElement.style.display = 'block';
                        downloadBtn.style.display = 'block';
                        audioPlayer.classList.remove('hidden');
                        audioElement.play();
                    } else {
                        showError(response.data.error || '음성 생성에 실패했습니다.');
                    }
                } catch (error) {
                    console.error('Error:', error);
                    showError(error.response?.data?.error || '오류가 발생했습니다.');
                } finally {
                    generateBtn.disabled = false;
                    loading.classList.add('hidden');
                }
            });

            // 다운로드
            downloadBtn.addEventListener('click', () => {
                if (!currentAudioUrl) return;
                
                const a = document.createElement('a');
                a.href = currentAudioUrl;
                a.download = 'gemini-tts-' + Date.now() + '.wav';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            });

            // 새로 만들기
            newBtn.addEventListener('click', () => {
                scriptInput.value = '';
                charCount.textContent = '0';
                audioPlayer.classList.add('hidden');
                audioElement.src = '';
                if (currentAudioUrl) {
                    URL.revokeObjectURL(currentAudioUrl);
                }
                currentAudioUrl = null;
                currentAudioData = null;
            });

            // 에러 표시
            function showError(message) {
                errorText.textContent = message;
                errorMsg.classList.remove('hidden');
            }
        </script>
    </body>
    </html>
  `)
})

export default app
