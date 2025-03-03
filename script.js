document.addEventListener('DOMContentLoaded', () => {
    const captureButton = document.getElementById('captureButton');
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
    let mediaRecorder = null;
    let audioChunks = [];
    let currentSpeech = null;

    // Configuração da API
    const OPENROUTER_API_KEY = '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';
    const ASSEMBLYAI_API_KEY = '458aa2eca05f431a95f72cbefd043a99';
    const SITE_URL = window.location.origin;
    const SITE_NAME = 'Screen Capture AI Chat';

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

        // Encontrar uma voz mais natural em português
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
                screenshot.style.display = 'block';
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

    async function startVoiceRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                await processAudio(audioBlob);
            };

            mediaRecorder.start();
            isRecording = true;
            micButton.classList.add('recording');
            micButton.querySelector('.mic-text').textContent = 'Gravando...';
        } catch (err) {
            console.error("Erro ao acessar o microfone:", err);
            alert("Erro ao acessar o microfone. Por favor, verifique as permissões.");
        }
    }

    function stopVoiceRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
            isRecording = false;
            micButton.classList.remove('recording');
            micButton.querySelector('.mic-text').textContent = 'Ativar Microfone';
        }
    }

    async function processAudio(audioBlob) {
        try {
            showTypingIndicator();

            // Primeiro, fazer upload do arquivo de áudio
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

            // Iniciar a transcrição
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

            // Polling para obter o resultado
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

            if (transcript.text) {
                addMessage(transcript.text, true);
                await processUserInput(transcript.text);
            }

        } catch (error) {
            console.error("Erro ao processar áudio:", error);
            alert("Erro ao processar o áudio. Por favor, tente novamente.");
        } finally {
            hideTypingIndicator();
        }
    }

    async function captureCurrentFrame() {
        if (!currentStream || !isCapturing) {
            await startScreenCapture();
            return lastScreenshotData;
        }

        const video = document.createElement('video');
        video.srcObject = currentStream;
        await video.play();

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/png');
        lastScreenshotData = dataUrl;
        return dataUrl;
    }

    async function analyzeImageWithAI(imageUrl, userQuestion) {
        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "HTTP-Referer": SITE_URL,
                    "X-Title": SITE_NAME,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "model": "qwen/qwen2.5-vl-72b-instruct:free",
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
                                        "url": imageUrl
                                    }
                                }
                            ]
                        }
                    ]
                })
            });

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            console.error("Erro ao analisar imagem com IA:", error);
            return "Desculpe, ocorreu um erro ao analisar a imagem. Por favor, tente novamente.";
        }
    }

    async function processUserInput(text) {
        const currentFrame = await captureCurrentFrame();
        if (!currentFrame) {
            alert("Erro ao capturar a tela. Por favor, tente novamente.");
            return;
        }

        showTypingIndicator();
        const aiResponse = await analyzeImageWithAI(currentFrame, text);
        hideTypingIndicator();
        addMessage(aiResponse, false);
    }

    // Iniciar captura automática ao carregar a página
    startScreenCapture();

    // Event Listeners
    captureButton.addEventListener('click', async () => {
        await startScreenCapture();
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
            startVoiceRecording();
        } else {
            stopVoiceRecording();
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