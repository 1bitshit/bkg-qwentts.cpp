#!/bin/bash
# Start the qwentts OpenAI-compatible TTS server.

../build/tts-server --model /notebooks/alpha/bkg-qwen-tts.cpp/models/qwen-talker-1.7b-customvoice-Q8_0.gguf --codec /notebooks/alpha/bkg-qwen-tts.cpp/models/qwen-tokenizer-12hz-Q8_0.gguf --host 0.0.0.0 --port 8010 --lang auto
#curl -X POST localhost:8010/v1/audio/speech -H "Content-Type: application/json" -d '{"input":"Hello world.","voice":"vivian","response_format":"wav","seed":42,"temperature":0.8}' -o out.wav