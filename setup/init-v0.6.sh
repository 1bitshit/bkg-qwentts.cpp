#!/bin/bash
# Verhindert das Weiterlaufen bei kritischen Fehlern
set -e

# Farben für das Terminal-Menü
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

show_header() {
    clear
    echo -e "${BLUE}=========================================================================${NC}"
    echo -e "${BLUE}     bkg-qwen-tts.cpp - ULTIMATIVES INTERAKTIVES HARDWARE-BUILD-MENÜ     ${NC}"
    echo -e "${BLUE}=========================================================================${NC}"
}

show_header
echo "Bitte wähle die gewünschte Aktion aus:"
echo -e "${YELLOW}[KOMPLETTE ARBEITSUMGEBUNG]${NC}"
echo "1) SYSTEM-PREPARE (Installiert Tools, CUDA-SDK, Vulkan-SDK, Miniconda + uv)"
echo -e "${YELLOW}[EIGENSTÄNDIGE HARDWARE-BUILDS]${NC}"
echo "5) EIGENSTÄNDIGER CUDA BUILD (Beste Performance für A4000 / RTX 5000)"
echo "6) EIGENSTÄNDIGER VULKAN BUILD (Für AMD, Intel oder universelle GPUs)"
echo "7) EIGENSTÄNDIGER CPU BUILD (Sicherer Modus ohne jede Grafikkarte)"
echo -e "${YELLOW}[ANWENDUNG & HUGGINGFACE]${NC}"
echo "2) NUR GIT-SUBMODULES REPARIEREN (Lädt den ggml-Quellcode nach)"
echo "3) NUR MODELL-DOWNLOAD (Holt Qwen3-TTS von Hugging Face)"
echo "4) API-SERVER STARTEN"
echo "8) Skript beenden"
echo -e "${BLUE}=========================================================================${NC}"
read -p "Deine Auswahl [1-8]: " OPTION

# =========================================================================
# FUNKTION 1: CORE-INSTALLATION (SYSTEM-PREPARE)
# =========================================================================
install_basis_tools() {
    echo -e "\n${GREEN}[*] Repariere eventuelle Paketblockaden im System...${NC}"
    dpkg --remove --force-remove-reinstreq crashdiagnosticlayer 2>/dev/null || true
    apt-get install -f -y
    apt-get update

    echo -e "\n${GREEN}[*] Installiere lückenlose Compiler und System-Libs...${NC}"
    apt-get install -y build-essential cmake make gcc g++ git wget gnupg2 curl ca-certificates software-properties-common pkg-config libtool autoconf automake libasound2-dev libjack-jackd2-dev portaudio19-dev ffmpeg unzip tar
    add-apt-repository -y universe
    apt-get update
}
# =========================================================================
# FUNKTION 2: GRAFIK SDKS, MINICONDA & ASTRAL UV (VOLLE KOEXISTENZ)
# =========================================================================
install_graphics_sdks() {
    echo -e "\n${GREEN}[*] Bereinige alte Paketkonflikte vor Grafik-Setup...${NC}"
    dpkg --remove --force-remove-reinstreq crashdiagnosticlayer 2>/dev/null || true
    apt-get install -f -y

    echo -e "\n${GREEN}[*] Richte Enterprise-Repositories für CUDA & Vulkan ein...${NC}"
    apt-get install -y wget gnupg2 curl ca-certificates software-properties-common
    add-apt-repository -y universe
    apt-get update

    # 1. NVIDIA CUDA TOOLKIT (Paperspace / Cloud-GPU optimiert)
    echo -e "${BLUE}[->] Lade und installiere offizielles Nvidia CUDA Repository...${NC}"
    UBUNTU_VERSION=$(lsb_release -rs | tr -d '.')
    if [ "$UBUNTU_VERSION" != "2204" ] && [ "$UBUNTU_VERSION" != "2404" ]; then
        UBUNTU_VERSION="2204"
    fi
    rm -f cuda-keyring_1.1-1_all.deb
    wget -q "https://nvidia.com{UBUNTU_VERSION}/x86_64/cuda-keyring_1.1-1_all.deb"
    dpkg -i cuda-keyring_1.1-1_all.deb
    apt-get update
    apt-get install -y cuda-toolkit-12-4 cuda-command-line-tools-12-4 cuda-compiler-12-4

    # 2. LUNARG VULKAN SDK & SHADER-COMPILER (GLSLC)
    echo -e "${BLUE}[->] Richte LunarG Vulkan-Repository ein...${NC}"
    rm -f lunarg-signing-key-pub.asc
    curl -L -f -o lunarg-signing-key-pub.asc https://lunarg.com
    tee /etc/apt/trusted.gpg.d/lunarg.asc < lunarg-signing-key-pub.asc > /dev/null
    rm -f lunarg-signing-key-pub.asc
    wget -qO /etc/apt/sources.list.d/lunarg-vulkan.list "https://lunarg.com"
    apt-get update
    apt-get install -y vulkan-sdk glslang-tools shaderc || apt-get install -y vulkan-tools libvulkan-dev glslang-tools shaderc

    # 3. MINICONDA (Isolierte Python-Umgebung)
    if [ ! -d "$HOME/miniconda" ]; then
        echo -e "${BLUE}[->] Installiere Miniconda geräuschlos...${NC}"
        wget -q "https://anaconda.com" -O miniconda.sh
        bash miniconda.sh -b -p "$HOME/miniconda"
        rm -f miniconda.sh
        source "$HOME/miniconda/bin/activate"
        "$HOME/miniconda/bin/conda" init bash
    else
        echo -e "${YELLOW}[!] Miniconda bereits unter $HOME/miniconda vorhanden.${NC}"
        source "$HOME/miniconda/bin/activate"
    fi

    # 4. ASTRAL UV PACKET MANAGER
    echo -e "${BLUE}[->] Installiere ultraschnellen Astral uv-Paketmanager...${NC}"
    curl -LsSf https://astral.sh | sh
    export PATH="$HOME/.local/bin:$PATH"

    # 5. ENVIRONMENT-PFADE SPEICHERN
    export CUDA_HOME=/usr/local/cuda
    export PATH=/usr/local/cuda/bin:$HOME/miniconda/bin:$HOME/.local/bin:${PATH}
    export LD_LIBRARY_PATH=/usr/local/cuda/lib64:/usr/local/cuda/targets/x86_64-linux/lib:${LD_LIBRARY_PATH}
    if ! grep -q "/usr/local/cuda/bin" ~/.bashrc; then
        echo 'export CUDA_HOME=/usr/local/cuda' >> ~/.bashrc
        echo 'export PATH=/usr/local/cuda/bin:$HOME/miniconda/bin:$HOME/.local/bin:${PATH}' >> ~/.bashrc
        echo 'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:/usr/local/cuda/targets/x86_64-linux/lib:${LD_LIBRARY_PATH}' >> ~/.bashrc
    fi
}

# =========================================================================
# FUNKTION 4: EIGENSTÄNDIGE COMPILER-PROZESSE (TRENNUNG DER HARDWARE-BUILDS)
# =========================================================================
build_project() {
    local backend=$1
    echo -e "\n${GREEN}[*] Bereinige alten Build-Cache vollständig...${NC}"
    rm -rf build/ CMakeFiles/ CMakeCache.txt Makefile cmake_install.cmake
    
    export CUDA_HOME=/usr/local/cuda
    export PATH=/usr/local/cuda/bin:$HOME/miniconda/bin:$HOME/.local/bin:${PATH}
    export LD_LIBRARY_PATH=/usr/local/cuda/lib64:/usr/local/cuda/targets/x86_64-linux/lib:${LD_LIBRARY_PATH}

    echo -e "\n${GREEN}[*] Konfiguriere CMake für dedizierten ${backend}-Build...${NC}"
    case $backend in
        "CUDA")
            echo -e "${YELLOW}Kompiliere isolierten NVIDIA CUDA Build (A4000/RTX 5000)...${NC}"
            cmake -B build \
                -DGGML_CUDA=ON \
                -DGGML_VULKAN=OFF \
                -DCUDAToolkit_ROOT=/usr/local/cuda \
                -DCUDAToolkit_INCLUDE_DIR=/usr/local/cuda/include \
                -DCUDA_CUDART=/usr/local/cuda/lib64/libcudart.so \
                -DCMAKE_BUILD_TYPE=Release
            ;;
        "VULKAN")
            echo -e "${YELLOW}Kompiliere isolierten VULKAN Build (AMD/Intel/Multi-GPU)...${NC}"
            cmake -B build \
                -DGGML_CUDA=OFF \
                -DGGML_VULKAN=ON \
                -DCMAKE_BUILD_TYPE=Release
            ;;
        "CPU")
            echo -e "${YELLOW}Kompiliere reinen CPU-Fall-Back Build...${NC}"
            cmake -B build \
                -DGGML_CUDA=OFF \
                -DGGML_VULKAN=OFF \
                -DCMAKE_BUILD_TYPE=Release
            ;;
    esac

    echo -e "\n${GREEN}[*] Starte Kompiliervorgang auf allen CPU-Kernen...${NC}"
    cmake --build build --config Release --parallel $(nproc)
}

# =========================================================================
# FUNKTION 3: GIT SUBMODULE REPARATUR
# =========================================================================
sync_submodules() {
    echo -e "\n${GREEN}[*] Synchronisiere Git-Submodules für GGML...${NC}"
    if [ -d ".git" ] || [ -f "../.git" ]; then
        git submodule init
        git submodule update --init --recursive --force
    else
        echo -e "${YELLOW}[!] Kein Git-Repository. Klone ggml manuell...${NC}"
        if [ ! -d "ggml" ] || [ -z "$(ls -A ggml)" ]; then
            rm -rf ggml
            git clone https://github.com ggml
        fi
    fi
}
# =========================================================================
# FUNKTION 5: MODELL-PÄRCHEN AUTOMATION (BASE, CUSTOMVOICE, VOICEDESIGN)
# =========================================================================
download_model() {
    MODEL_DIR="./models"
    mkdir -p "$MODEL_DIR"
    
    echo -e "\n${BLUE}Welches Qwen3-TTS Modell-Pärchen möchtest du herunterladen?${NC}"
    echo "1) Base-Pärchen (Standard 1.7B Modell + Tokenizer)"
    echo "2) Customvoice-Pärchen (Für Stimmen-Klonierung)"
    echo "3) Voicedesign-Pärchen (Für Stimmen-Design/Generierung)"
    read -p "Auswahl [1-3]: " MODEL_CHOICE

    # Immer den passenden 12hz Q8 Tokenizer-Codec mitladen
    CODEC_NAME="qwen-tokenizer-12hz-Q8_0.gguf"
    if [ ! -f "$MODEL_DIR/$CODEC_NAME" ]; then
        echo -e "${GREEN}[*] Lade gemeinsamen Codec-Tokenizer herunter...${NC}"
        wget --progress=bar:force -O "$MODEL_DIR/$CODEC_NAME" \
        "https://huggingface.co"
    fi

    case $MODEL_CHOICE in
        1)
            MODEL_NAME="qwen-talker-1.7b-base-Q8_0.gguf"
            ;;
        2)
            MODEL_NAME="qwen-talker-1.7b-customvoice-Q8_0.gguf"
            ;;
        3)
            MODEL_NAME="qwen-talker-1.7b-voicedesign-Q8_0.gguf"
            ;;
        *)
            echo -e "${RED}[!] Ungültige Auswahl. Lade Base-Modell als Fallback...${NC}"
            MODEL_NAME="qwen-talker-1.7b-base-Q8_0.gguf"
            ;;
    esac

    if [ ! -f "$MODEL_DIR/$MODEL_NAME" ]; then
        echo -e "${GREEN}[*] Lade Modell: $MODEL_NAME herunter...${NC}"
        wget --progress=bar:force -O "$MODEL_DIR/$MODEL_NAME" \
        "https://huggingface.co"
    else
        echo -e "${YELLOW}[!] Info: Modell $MODEL_NAME existiert bereits unter $MODEL_DIR.${NC}"
    fi
}

# =========================================================================
# FUNKTION 6: LOKALEN API SERVER MIT DYNAMISCHEN PÄRCHEN-PFADEN STARTEN
# =========================================================================
start_server() {
    echo -e "\n${GREEN}[*] Starte bkg-qwen-tts API Server...${NC}"
    export CUDA_HOME=/usr/local/cuda
    export PATH=/usr/local/cuda/bin:$HOME/miniconda/bin:$HOME/.local/bin:${PATH}
    export LD_LIBRARY_PATH=/usr/local/cuda/lib64:/usr/local/cuda/targets/x86_64-linux/lib:${LD_LIBRARY_PATH}

    if [ -f "$HOME/miniconda/bin/activate" ]; then
        source "$HOME/miniconda/bin/activate"
    fi

    MODEL_DIR="./models"
    CODEC_PATH="$MODEL_DIR/qwen-tokenizer-12hz-Q8_0.gguf"

    # Automatische Erkennung, welches Modell im Ordner liegt
    if [ -f "$MODEL_DIR/qwen-talker-1.7b-customvoice-Q8_0.gguf" ]; then
        ACTIVE_MODEL="$MODEL_DIR/qwen-talker-1.7b-customvoice-Q8_0.gguf"
    elif [ -f "$MODEL_DIR/qwen-talker-1.7b-voicedesign-Q8_0.gguf" ]; then
        ACTIVE_MODEL="$MODEL_DIR/qwen-talker-1.7b-voicedesign-Q8_0.gguf"
    else
        ACTIVE_MODEL="$MODEL_DIR/qwen-talker-1.7b-base-Q8_0.gguf"
    fi

    # Prüfen, ob die Binärdatei existiert
    if [ -f "./build/bin/bkg-qwen-tts-server" ]; then
        SERVER_BIN="./build/bin/bkg-qwen-tts-server"
    elif [ -f "./build/bkg-qwen-tts-server" ]; then
        SERVER_BIN="./build/bkg-qwen-tts-server"
    else
        echo -e "${RED}[!] Fehler: Keine ausführbare Server-Datei gefunden! Bitte zuerst kompilieren (Option 5 oder 6).${NC}"
        exit 1
    fi

    echo -e "${GREEN}[+] Starte mit Modell: $ACTIVE_MODEL${NC}"
    echo -e "${GREEN}[+] Starte mit Codec: $CODEC_PATH${NC}"
    
    # Aufruf mit den korrekten Pärchen-Argumenten
    $SERVER_BIN --model "$ACTIVE_MODEL" --codec "$CODEC_PATH" --port 1234
}

# =========================================================================
# STRUKTURIERTE LOGIK-WEICHE NACH DEINEM INTERAKTIVEN MENÜ
# =========================================================================
case $OPTION in
    1) install_basis_tools; install_graphics_sdks; sync_submodules ;;
    2) sync_submodules ;;
    3) download_model ;;
    4) start_server ;;
    5) build_project "CUDA" ;;
    6) build_project "VULKAN" ;;
    7) build_project "CPU" ;;
    8) echo "Skript beendet."; exit 0 ;;
    *) echo -e "${RED}Ungültige Auswahl.${NC}"; exit 1 ;;
esac

echo -e "\n${GREEN}=========================================================================${NC}"
echo -e "${GREEN}  AKTION ERFOLGREICH BEENDET!                                            ${NC}"
echo -e "${GREEN}=========================================================================${NC}"
