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
    echo -e "${BLUE}     bkg-qwen-tts.cpp - GRANULARES HARDWARE & ENGINE MASTER-MENÜ         ${NC}"
    echo -e "${BLUE}=========================================================================${NC}"
}

show_header
echo "Bitte wähle den exakten Installations- oder Build-Schritt aus:"
echo -e "${YELLOW}[1. SYSTEM & DEPENDENCIES - EINZELPUNKTE]${NC}"
echo "1) NUR BASIS BUILD-TOOLS (CMake, GCC, Make, Git, Audio-Libs)"
echo "2) NUR NVIDIA CUDA SETUP (Erkennung / treiberloses Toolkit)"
echo "3) NUR LUNARG VULKAN SETUP (GPG-Key-Fix + SDK + glslc Compiler)"
echo "4) NUR MINICONDA SETUP (Sicherer Binär-CDN-Download + Aktivierung)"
echo "5) NUR ASTRAL UV SETUP (Ultraschneller Python-Paketmanager)"
echo -e "${YELLOW}[2. EIGENSTÄNDIGE HARDWARE-BUILDS]${NC}"
echo "6) PROJEKT-BUILD: ISOLIERTER CUDA BUILD (A4000 / RTX 5000 / Colab)"
echo "7) PROJEKT-BUILD: ISOLIERTER VULKAN BUILD (AMD / Intel / Universell)"
echo "8) PROJEKT-BUILD: REINER CPU BUILD (Sicherer Fallback-Modus)"
echo -e "${YELLOW}[3. ANWENDUNG & SERVER]${NC}"
echo "9) GIT-SUBMODULES SYNCHRONISIEREN (Lädt ggml nach)"
echo "10) MODELL-PÄRCHEN DOWNLOAD (Base, Customvoice, Voicedesign + Tokenizer)"
echo "11) API-SERVER STARTEN"
echo "12) Skript beenden"
echo -e "${BLUE}=========================================================================${NC}"
read -p "Deine Auswahl [1-12]: " OPTION

# =========================================================================
# PUNKT 1: CORE-INSTALLATION (SYSTEM BASIS TOOLS)
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
# PUNKT 2: NVIDIA CUDA TOOLKIT PIPELINE (DEPRECATION-FREE MODERNE KEYS)
# =========================================================================
install_cuda() {
    echo -e "\n${GREEN}[*] Starte dediziertes CUDA-Setup...${NC}"
    echo "1) Normaler Ubuntu Server (Home-Server, Root-Server, Hetzner)"
    echo "2) Cloud-Plattform (Paperspace, Google Colab, RunPod)"
    read -p "Umgebung wählen [1-2]: " CUDA_ENV

    if [ "$CUDA_ENV" = "1" ]; then
        echo -e "${BLUE}[->] Lade offizielles Nvidia Ubuntu Repository modern herunter...${NC}"
        UBUNTU_VERSION=$(lsb_release -rs | tr -d '.')
        if [ "$UBUNTU_VERSION" != "2204" ] && [ "$UBUNTU_VERSION" != "2404" ]; then UBUNTU_VERSION="2204"; fi
        
        # Säuberung alter Reste
        rm -f /etc/apt/trusted.gpg.d/nvidia-cuda.gpg || true
        
        # Den Schlüssel direkt modern und dearmort ablegen (Verhindert die apt-key Warnung)
        curl -fsSL "https://nvidia.com{UBUNTU_VERSION}/x86_64/3bf863cc.pub" | gpg --dearmor -o /etc/apt/trusted.gpg.d/nvidia-cuda.gpg --yes
        
        # Repository-Eintrag hinzufügen
        echo "deb [signed-by=/etc/apt/trusted.gpg.d/nvidia-cuda.gpg] https://nvidia.com{UBUNTU_VERSION}/x86_64/ /" > /etc/apt/sources.list.d/nvidia-cuda.list
        
        apt-get update
        apt-get install -y cuda-toolkit-12-4 cuda-command-line-tools-12-4 cuda-compiler-12-4
    else
        echo -e "${BLUE}[->] Cloud-Modus: Prüfe vorinstalliertes CUDA unter /usr/local/cuda...${NC}"
        if [ -d "/usr/local/cuda" ] && command -v /usr/local/cuda/bin/nvcc &> /dev/null; then
            echo -e "${GREEN}[+] CUDA bereits im Container vorhanden!${NC}"
        else
            echo -e "${YELLOW}[!] Kein CUDA gefunden. Installiere treiberlose Minimalversion...${NC}"
            apt-get install -y --no-install-recommends cuda-toolkit-12-4 || apt-get install -y --no-install-recommends nvidia-cuda-toolkit || true
        fi
    fi
}


# =========================================================================
# PUNKT 3: LUNARG VULKAN SDK & GLSLC REIN-IMPORT (OFFIZIELLES FIX)
# =========================================================================
install_vulkan() {
    echo -e "\n${GREEN}[*] Starte sauberes LunarG Vulkan-Setup...${NC}"
    # Alte, fehlerhafte Repo-Reste restlos löschen
    rm -f /etc/apt/sources.list.d/lunarg-vulkan.list || true
    rm -f /etc/apt/sources.list.d/lunarg-vulkan-jammy.list || true
    rm -f /etc/apt/trusted.gpg.d/lunarg-vulkan.gpg || true
    rm -f /etc/apt/trusted.gpg.d/lunarg.asc || true

    echo -e "${BLUE}[->] Füge LunarG GPG-Schlüssel direkt hinzu...${NC}"
    # Die offizielle, robuste LunarG-Methode für Ubuntu
    wget -qO- https://packages.lunarg.com/lunarg-signing-key-pub.asc | tee /etc/apt/trusted.gpg.d/lunarg.asc > /dev/null

    echo -e "${BLUE}[->] Registriere offizielles LunarG Repository für Jammy...${NC}"
    # Nutzt den direkten HTTP/HTTPS-Spiegelpfad von LunarG
    wget -qO /etc/apt/sources.list.d/lunarg-vulkan-jammy.list http://packages.lunarg.com/vulkan/lunarg-vulkan-jammy.list

    echo -e "${BLUE}[->] Aktualisiere Paketquellen mit neuem Schlüssel...${NC}"
    apt-get update

    echo -e "${BLUE}[->] Installiere Vulkan-SDK und den glslc-Compiler...${NC}"
    # Installiert das vollständige SDK mitsamt Shader-Compilern
    apt-get install -y vulkan-sdk
}

# =========================================================================
# PUNKT 4: MINICONDA CONTROL PIPELINE
# =========================================================================
install_miniconda() {
    echo -e "\n${GREEN}[*] Starte isoliertes Miniconda-Setup...${NC}"
    if [ ! -d "$HOME/miniconda" ] && [ ! -d "$HOME/miniconda3" ]; then
        echo -e "${BLUE}[->] Lade Miniconda via offizieller CDN-Direkt-URL...${NC}"
        rm -f miniconda.sh
        curl -L -f -o miniconda.sh "https://anaconda.com"
        
        if head -n 5 miniconda.sh | grep -q -i "doctype"; then
            echo -e "${RED}[!] FEHLER: Download lieferte HTML anstelle einer Binärdatei!${NC}"
            exit 1
        fi
        
        echo -e "${BLUE}[->] Installiere Miniconda silent in das Home-Verzeichnis...${NC}"
        bash miniconda.sh -b -p "$HOME/miniconda"
        rm -f miniconda.sh
        source "$HOME/miniconda/bin/activate"
        "$HOME/miniconda/bin/conda" init bash
        echo -e "${GREEN}[+] Miniconda wurde erfolgreich initialisiert!${NC}"
    else
        echo -e "${YELLOW}[!] Miniconda ist bereits unter $HOME/miniconda vorhanden.${NC}"
    fi
}

# =========================================================================
# PUNKT 5: ASTRAL UV CONTROL PIPELINE
# =========================================================================
install_uv() {
    echo -e "\n${GREEN}[*] Starte Astral uv-Setup...${NC}"
    curl -LsSf https://astral.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
    
    # Pfad-Verlinkung und Umgebungsvariablen permanent machen
    export CUDA_HOME=/usr/local/cuda
    export PATH=/usr/local/cuda/bin:$HOME/miniconda/bin:$HOME/.local/bin:${PATH}
    export LD_LIBRARY_PATH=/usr/local/cuda/lib64:/usr/local/cuda/targets/x86_64-linux/lib:${LD_LIBRARY_PATH}
    
    if ! grep -q "/usr/local/cuda/bin" ~/.bashrc; then
        echo 'export CUDA_HOME=/usr/local/cuda' >> ~/.bashrc
        echo 'export PATH=/usr/local/cuda/bin:$HOME/miniconda/bin:$HOME/.local/bin:${PATH}' >> ~/.bashrc
        echo 'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:/usr/local/cuda/targets/x86_64-linux/lib:${LD_LIBRARY_PATH}' >> ~/.bashrc
    fi
    echo -e "${GREEN}[+] Astral uv wurde installiert und Umgebungsvariablen gesetzt!${NC}"
}
# =========================================================================
# FUNKTION 6-8: COMPILER PROZESS (MAXIMALISIERTE HARDWARE-BUILDS)
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
            echo -e "${YELLOW}Kompiliere isolierten NVIDIA CUDA Build (A4000 / RTX 5000 / Colab)...${NC}"
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
            echo -e "${YELLOW}Kompiliere reinen CPU Build...${NC}"
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
# FUNKTION 9: GIT SUBMODULE REPARATUR
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
# FUNKTION 10: MODELL-PÄRCHEN AUTOMATION (BASE, CUSTOMVOICE, VOICEDESIGN)
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
        echo -e "${GREEN}[*] Lade gemeinsamen Codec-Tokenizer von Hugging Face herunter...${NC}"
        wget --progress=bar:force -O "$MODEL_DIR/$CODEC_NAME" \
        "https://huggingface.co"
    fi

    case $MODEL_CHOICE in
        1) MODEL_NAME="qwen-talker-1.7b-base-Q8_0.gguf" ;;
        2) MODEL_NAME="qwen-talker-1.7b-customvoice-Q8_0.gguf" ;;
        3) MODEL_NAME="qwen-talker-1.7b-voicedesign-Q8_0.gguf" ;;
        *) echo -e "${RED}[!] Ungültige Auswahl. Nutze Base als Fallback...${NC}"; MODEL_NAME="qwen-talker-1.7b-base-Q8_0.gguf" ;;
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
# FUNKTION 11: LOKALEN API SERVER STARTEN
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

    if [ -f "$MODEL_DIR/qwen-talker-1.7b-customvoice-Q8_0.gguf" ]; then
        ACTIVE_MODEL="$MODEL_DIR/qwen-talker-1.7b-customvoice-Q8_0.gguf"
    elif [ -f "$MODEL_DIR/qwen-talker-1.7b-voicedesign-Q8_0.gguf" ]; then
        ACTIVE_MODEL="$MODEL_DIR/qwen-talker-1.7b-voicedesign-Q8_0.gguf"
    else
        ACTIVE_MODEL="$MODEL_DIR/qwen-talker-1.7b-base-Q8_0.gguf"
    fi

    if [ -f "./build/bin/bkg-qwen-tts-server" ]; then SERVER_BIN="./build/bin/bkg-qwen-tts-server"
    elif [ -f "./build/bkg-qwen-tts-server" ]; then SERVER_BIN="./build/bkg-qwen-tts-server"
    else
        echo -e "${RED}[!] Fehler: Keine ausführbare Server-Datei gefunden! Bitte zuerst kompilieren (Option 6, 7 oder 8).${NC}"
        exit 1
    fi

    echo -e "${GREEN}[+] Starte mit Modell: $ACTIVE_MODEL${NC}"
    echo -e "${GREEN}[+] Starte mit Codec: $CODEC_PATH${NC}"
    $SERVER_BIN --model "$ACTIVE_MODEL" --codec "$CODEC_PATH" --port 1234
}

# =========================================================================
# DYNAMISCHE STRUKTURIERTE MENÜ-WEICHE FÜR ALLE 12 EINZELPUNKTE
# =========================================================================
case $OPTION in
    1) install_basis_tools ;;
    2) install_cuda ;;
    3) install_vulkan ;;
    4) install_miniconda ;;
    5) install_uv ;;
    6) build_project "CUDA" ;;
    7) build_project "VULKAN" ;;
    8) build_project "CPU" ;;
    9) sync_submodules ;;
    10) download_model ;;
    11) start_server ;;
    12) echo "Skript beendet."; exit 0 ;;
    *) echo -e "${RED}Ungültige Auswahl.${NC}"; exit 1 ;;
esac

echo -e "\n${GREEN}=========================================================================${NC}"
echo -e "${GREEN}  SCHRITT ERFOLGREICH BEENDET!                                           ${NC}"
echo -e "${GREEN}=========================================================================${NC}"
