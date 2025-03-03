document.addEventListener('DOMContentLoaded', () => {
    const captureButton = document.getElementById('captureButton');
    const cameraButton = document.getElementById('cameraButton');
    const cameraPreview = document.getElementById('cameraPreview');
    const screenshot = document.getElementById('screenshot');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    const chatMessages = document.getElementById('chatMessages');
    const typingIndicator = document.getElementById('typingIndicator');
    const micButton = document.getElementById('micButton');
    const stopTTSButton = document.getElementById('stopTTS');

    let lastScreenshotData = null;
    let currentStream = null;
    let isCapturing = false;
    let isRecording = false;
    let isCameraActive = false;
    let mediaRecorder = null;
    let audioChunks = [];
    let currentSpeech = null;
    let lastProcessedText = '';
    let processingAudio = false;
    let silenceTimeout = null;

    // Configuração da API
    const OPENROUTER_API_KEY = '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';
    const ASSEMBLYAI_API_KEY = '458aa2eca05f431a95f72cbefd043a99';
    const SITE_URL = 'https://understand-capture.vercel.app';  // URL fixa do site
    const SITE_NAME = 'Screen Capture AI Chat';

    // Detectar se é dispositivo móvel
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // Ajustar interface baseado no dispositivo
    if (isMobile) {
        captureButton.style.display = 'none';
        cameraButton.style.display = 'flex';
    } else {
        cameraButton.style.display = 'none';
    }

    function showTypingIndicator() {
        typingIndicator.classList.add('visible');
    }

    function hideTypingIndicator() {
        typingIndicator.classList.remove('visible');
    }

    function addMessage(text, isUser) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
        messageDiv.textContent = text;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        if (!isUser) {
            speakText(text);
        }
    }

    function speakText(text) {
        if (currentSpeech) {
            currentSpeech.cancel();
        }

        currentSpeech = new SpeechSynthesisUtterance(text);
        currentSpeech.lang = 'pt-BR';
        currentSpeech.rate = 1;
        currentSpeech.pitch = 1;

        const voices = speechSynthesis.getVoices();
        const brVoice = voices.find(voice => voice.lang.includes('pt-BR'));
        if (brVoice) {
            currentSpeech.voice = brVoice;
        }

        stopTTSButton.style.display = 'flex';
        speechSynthesis.speak(currentSpeech);

        currentSpeech.onend = () => {
            stopTTSButton.style.display = 'none';
        };
    }

    async function startScreenCapture() {
        try {
            if (currentStream) {
                currentStream.getTracks().forEach(track => track.stop());
            }

            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: "always"
                },
                audio: false
            });

            currentStream = stream;
            isCapturing = true;
            isCameraActive = false;
            cameraPreview.style.display = 'none';
            screenshot.style.display = 'block';

            const video = document.createElement('video');
            video.srcObject = stream;
            await video.play();

            const updateScreenshot = () => {
                if (!isCapturing) return;

                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                const context = canvas.getContext('2d');
                context.drawImage(video, 0, 0, canvas.width, canvas.height);

                const dataUrl = canvas.toDataURL('image/png');
                lastScreenshotData = dataUrl;
                screenshot.src = dataUrl;
            };

            const intervalId = setInterval(updateScreenshot, 1000);

            stream.getVideoTracks()[0].addEventListener('ended', () => {
                clearInterval(intervalId);
                isCapturing = false;
                currentStream = null;
            });

            return stream;
        } catch (err) {
            console.error("Erro ao capturar a tela:", err);
            alert("Erro ao capturar a tela. Por favor, tente novamente.");
            return null;
        }
    }

    async function startCamera() {
        try {
            if (currentStream) {
                currentStream.getTracks().forEach(track => track.stop());
            }

            const constraints = {
                video: {
                    facingMode: isMobile ? 'environment' : 'user',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            currentStream = stream;
            isCameraActive = true;
            isCapturing = true;

            cameraPreview.srcObject = stream;
            cameraPreview.style.display = 'block';
            screenshot.style.display = 'none';

            // Garantir que o vídeo está carregado
            await new Promise((resolve) => {
                cameraPreview.onloadedmetadata = () => {
                    cameraPreview.play();
                    resolve();
                };
            });

            cameraButton.classList.add('active');

            // Capturar frames da câmera periodicamente
            const intervalId = setInterval(() => {
                if (!isCameraActive) {
                    clearInterval(intervalId);
                    return;
                }

                const canvas = document.createElement('canvas');
                canvas.width = cameraPreview.videoWidth;
                canvas.height = cameraPreview.videoHeight;

                const context = canvas.getContext('2d');
                context.drawImage(cameraPreview, 0, 0, canvas.width, canvas.height);

                lastScreenshotData = canvas.toDataURL('image/png');
            }, 1000);

            return stream;
        } catch (err) {
            console.error("Erro ao acessar a câmera:", err);
            alert("Erro ao acessar a câmera. Por favor, verifique as permissões.");
            return null;
        }
    }

    function stopCamera() {
        if (currentStream && isCameraActive) {
            currentStream.getTracks().forEach(track => track.stop());
            currentStream = null;
            isCameraActive = false;
            isCapturing = false;
            cameraPreview.style.display = 'none';
            cameraButton.classList.remove('active');
        }
    }

    async function startVoiceRecognition() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            isRecording = true;
            micButton.classList.add('recording');
            micButton.querySelector('.mic-text').textContent = 'Ouvindo...';

            let currentAudioChunks = [];
            let isCollectingAudio = false;

            // Detector de silêncio
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
            const processor = audioContext.createScriptProcessor(1024, 1, 1);
            const analyser = audioContext.createAnalyser();

            source.connect(analyser);
            analyser.connect(processor);
            processor.connect(audioContext.destination);

            let silenceStart = Date.now();
            const silenceThreshold = -50; // dB
            const minAudioLength = 1000; // 1 segundo
            const maxAudioLength = 10000; // 10 segundos

            processor.onaudioprocess = function(e) {
                const input = e.inputBuffer.getChannelData(0);
                let sum = 0;
                for (let i = 0; i < input.length; i++) {
                    sum += input[i] * input[i];
                }
                const rms = Math.sqrt(sum / input.length);
                const db = 20 * Math.log10(rms);

                if (db < silenceThreshold) {
                    if (!isCollectingAudio) {
                        silenceStart = Date.now();
                    } else if (Date.now() - silenceStart > 1000) {
                        // Se houver silêncio por mais de 1 segundo e tivermos áudio coletado
                        if (currentAudioChunks.length > 0) {
                            const audioBlob = new Blob(currentAudioChunks, { type: 'audio/wav' });
                            processAudio(audioBlob);
                            currentAudioChunks = [];
                        }
                        isCollectingAudio = false;
                    }
                } else {
                    if (!isCollectingAudio) {
                        isCollectingAudio = true;
                        mediaRecorder.start();
                    }
                    silenceStart = Date.now();
                }
            };

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    currentAudioChunks.push(event.data);
                }
            };

            // Parar a gravação periodicamente para evitar arquivos muito grandes
            setInterval(() => {
                if (isCollectingAudio) {
                    mediaRecorder.stop();
                    mediaRecorder.start();
                }
            }, maxAudioLength);

            return stream;
        } catch (err) {
            console.error("Erro ao acessar o microfone:", err);
            alert("Erro ao acessar o microfone. Por favor, verifique as permissões.");
            return null;
        }
    }

    function stopVoiceRecognition() {
        if (mediaRecorder && isRecording) {
            isRecording = false;
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
            micButton.classList.remove('recording');
            micButton.querySelector('.mic-text').textContent = 'Falar em Tempo Real';
        }
    }

    async function processAudio(audioBlob) {
        if (processingAudio) return;
        processingAudio = true;

        try {
            const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
                method: 'POST',
                headers: {
                    'Authorization': ASSEMBLYAI_API_KEY
                },
                body: audioBlob
            });

            if (!uploadResponse.ok) {
                throw new Error('Erro ao fazer upload do áudio');
            }

            const uploadResult = await uploadResponse.json();
            const audioUrl = uploadResult.upload_url;

            const transcribeResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
                method: 'POST',
                headers: {
                    'Authorization': ASSEMBLYAI_API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    audio_url: audioUrl,
                    language_code: 'pt'
                })
            });

            if (!transcribeResponse.ok) {
                throw new Error('Erro ao iniciar transcrição');
            }

            const transcribeResult = await transcribeResponse.json();
            const transcriptId = transcribeResult.id;

            let transcript;
            while (true) {
                const pollingResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
                    headers: {
                        'Authorization': ASSEMBLYAI_API_KEY
                    }
                });

                transcript = await pollingResponse.json();

                if (transcript.status === 'completed') {
                    break;
                } else if (transcript.status === 'error') {
                    throw new Error('Erro na transcrição');
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            if (transcript.text && transcript.text.trim() !== '' && transcript.text !== lastProcessedText) {
                lastProcessedText = transcript.text;
                addMessage(transcript.text, true);
                await processUserInput(transcript.text);
            }

        } catch (error) {
            console.error("Erro ao processar áudio:", error);
        } finally {
            processingAudio = false;
        }
    }

    async function captureCurrentFrame() {
        try {
            const canvas = document.createElement('canvas');
            let width = 800; // Tamanho máximo para reduzir o tamanho do arquivo
            let height = 600;
            let sourceElement;

            if (isCameraActive && cameraPreview.videoWidth > 0) {
                sourceElement = cameraPreview;
                const aspectRatio = sourceElement.videoWidth / sourceElement.videoHeight;
                height = width / aspectRatio;
            } else if (screenshot.src && screenshot.src !== '') {
                sourceElement = screenshot;
                const aspectRatio = sourceElement.width / sourceElement.height;
                height = width / aspectRatio;
            } else {
                throw new Error('Nenhuma imagem disponível para captura');
            }

            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            
            // Aplicar suavização
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            
            // Desenhar a imagem redimensionada
            context.drawImage(sourceElement, 0, 0, width, height);

            // Converter para JPEG com qualidade reduzida
            const base64Data = canvas.toDataURL('image/jpeg', 0.7);
            
            // Verificar o tamanho dos dados
            const estimatedSize = Math.round((base64Data.length * 3) / 4);
            console.log(`Tamanho estimado da imagem: ${Math.round(estimatedSize / 1024)}KB`);

            return base64Data;
        } catch (error) {
            console.error("Erro ao capturar frame:", error);
            return null;
        }
    }

    async function analyzeImageWithAI(imageBase64, userQuestion) {
        try {
            console.log("Iniciando análise da imagem...");
            
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": SITE_URL,
                    "X-Title": SITE_NAME,
                    "OpenAI-Organization": "org-123",
                    "X-Custom-Auth": "true"
                },
                body: JSON.stringify({
                    "model": "anthropic/claude-3-haiku",
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": userQuestion || "O que você vê nesta imagem? Por favor, descreva detalhadamente."
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": imageBase64
                                    }
                                }
                            ]
                        }
                    ]
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error("Erro da API:", errorText);
                throw new Error(`Erro na API: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            console.log("Resposta da API recebida com sucesso");
            return data.choices[0].message.content;
        } catch (error) {
            console.error("Erro detalhado ao analisar imagem:", error);
            throw new Error(`Erro ao analisar imagem: ${error.message}`);
        }
    }

    async function processUserInput(text) {
        try {
            const imageData = await captureCurrentFrame();
            if (!imageData) {
                throw new Error("Não foi possível capturar a imagem");
            }

            showTypingIndicator();
            console.log("Processando imagem...");
            const aiResponse = await analyzeImageWithAI(imageData, text);
            hideTypingIndicator();
            addMessage(aiResponse, false);
        } catch (error) {
            console.error("Erro detalhado ao processar entrada:", error);
            hideTypingIndicator();
            addMessage(`Erro ao processar sua solicitação: ${error.message}. Por favor, verifique se a câmera ou compartilhamento de tela está ativo e tente novamente.`, false);
        }
    }

    // Inicialização
    if (isMobile) {
        startCamera();
    } else {
        startScreenCapture();
    }

    // Event Listeners
    captureButton.addEventListener('click', async () => {
        await startScreenCapture();
    });

    cameraButton.addEventListener('click', async () => {
        if (!isCameraActive) {
            await startCamera();
        } else {
            stopCamera();
        }
    });

    sendButton.addEventListener('click', async () => {
        const question = userInput.value.trim();
        if (!question) return;

        addMessage(question, true);
        userInput.value = '';
        await processUserInput(question);
    });

    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendButton.click();
        }
    });

    micButton.addEventListener('click', () => {
        if (!isRecording) {
            startVoiceRecognition();
        } else {
            stopVoiceRecognition();
        }
    });

    stopTTSButton.addEventListener('click', () => {
        if (currentSpeech) {
            speechSynthesis.cancel();
            stopTTSButton.style.display = 'none';
        }
    });

    // Carregar vozes disponíveis
    speechSynthesis.addEventListener('voiceschanged', () => {
        const voices = speechSynthesis.getVoices();
        console.log('Vozes disponíveis:', voices);
    });
}); 