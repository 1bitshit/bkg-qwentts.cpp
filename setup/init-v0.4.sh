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
    echo -e "${BLUE}        bkg-qwen-tts.cpp - COMPLETE SYSTEM SETUP & COMPILER SCRIPT       ${NC}"
    echo -e "${BLUE}=========================================================================${NC}"
}

show_header
echo "Bitte wähle die gewünschte Installations-Kombination aus:"
echo -e "${YELLOW}[KOMPLETTE SYSTEME]${NC}"
echo "1) ALLES VON NULL AUF (Basis-Tools + CUDA + Vulkan + Submodules + Hybrid-Build + Model)"
echo -e "${YELLOW}[EINZELNE BAUSTEINE]${NC}"
echo "2) NUR BASIS BUILD-TOOLS & SYSTEM-LIBS (CMake, GCC, Python-Dev, Audio-Libs etc.)"
echo "3) NUR GRAFIK-TREIBER & SDKS (WSL2-Spezifisches CUDA Toolkit + Vulkan SDK + glslc)"
echo "4) NUR GIT-SUBMODULES SYNCHRONISIEREN (Repariert den leeren ggml-Ordner)"
echo "5) NUR PROJEKT-BUILD: CUDA + Vulkan Parallel-Build (Löscht Cache & kompiliert)"
echo "6) NUR PROJEKT-BUILD: Reiner CPU-Build (Ohne Grafikkarte kompilieren)"
echo "7) NUR MODELL-DOWNLOAD (Lädt Qwen3-TTS .gguf von Hugging Face)"
echo -e "${GREEN}[SERVER-STEUERUNG]${NC}"
echo "8) LOKALEN API-SERVER STARTEN (Startet das kompilierte Modell)"
echo "9) Skript beenden"
echo -e "${BLUE}=========================================================================${NC}"
read -p "Deine Auswahl [1-9]: " OPTION

# =========================================================================
# FUNKTION 1: BASIS BUILD-TOOLS & SYSTEM-BIBLIOTHEKEN (MIT SYSTEM-REPARATUR)
# =========================================================================
install_basis_tools() {
    echo -e "\n${GREEN}[*] Repariere blockierte Paketabhängigkeiten im System...${NC}"
    # Bereinigt radikal das defekte crashdiagnosticlayer-Paket
    dpkg --remove --force-remove-reinstreq crashdiagnosticlayer 2>/dev/null || true
    apt-get autoremove -y crashdiagnosticlayer 2>/dev/null || true
    
    # Repariert den Paketmanager
    apt-get install -f -y
    apt-get clean
    apt-get update

    echo -e "\n${GREEN}[*] Installiere lückenlose Build-Tools, Compiler und Python-Pakete...${NC}"
    apt-get install -y \
        build-essential \
        cmake \
        make \
        gcc \
        g++ \
        git \
        wget \
        gnupg2 \
        curl \
        ca-certificates \
        software-properties-common \
        pkg-config \
        libtool \
        autoconf \
        automake \
        python3 \
        python3-pip \
        python3-dev \
        python3-venv \
        libasound2-dev \
        libjack-jackd2-dev \
        portaudio19-dev \
        ffmpeg \
        unzip \
        tar
    
    # Freischalten des Universe-Repositories für erweiterte Pakete
    add-apt-repository -y universe
    apt-get update
}
# =========================================================================
# FUNKTION 2: GRAFIK TREIBER & SDKS (WSL2 OPTIMIERT + KOEXISTENZ CUDA & VULKAN)
# =========================================================================
install_graphics_sdks() {
    echo -e "\n${GREEN}[*] Bereinige alte Paketkonflikte vor Grafik-Installation...${NC}"
    dpkg --remove --force-remove-reinstreq crashdiagnosticlayer 2>/dev/null || true
    apt-get install -f -y

    echo -e "\n${GREEN}[*] Richte Repositories ein und installiere Compiler für WSL2...${NC}"
    apt-get install -y wget gnupg2 curl ca-certificates software-properties-common
    add-apt-repository -y universe
    apt-get update

    # 1. CUDA TOOLKIT DIREKT AUS UBUNTU-QUELLEN (Erzwingt Stabilität unter WSL2)
    echo -e "${BLUE}[->] Installiere CUDA-Toolkit direkt über Ubuntu-Standardquellen...${NC}"
    apt-get install -y --no-install-recommends nvidia-cuda-toolkit

    # 2. VULKAN SDK & ALL-IN-ONE COMPILER (GLSLC) ÜBER LUNARG REPOSITORY
    echo -e "${BLUE}[->] Lade LunarG Vulkan Repository-Schlüssel herunter...${NC}"
    rm -f lunarg-signing-key-pub.asc
    curl -L -f -o lunarg-signing-key-pub.asc https://lunarg.com
    tee /etc/apt/trusted.gpg.d/lunarg.asc < lunarg-signing-key-pub.asc > /dev/null
    rm -f lunarg-signing-key-pub.asc

    echo -e "${BLUE}[->] Füge LunarG Repository zu den Paketquellen hinzu...${NC}"
    wget -qO /etc/apt/sources.list.d/lunarg-vulkan.list https://lunarg.com
    apt-get update
    
    echo -e "${BLUE}[->] Installiere Vulkan SDK, Shaderc, glslc und glslang Tools...${NC}"
    apt-get install -y vulkan-sdk glslang-tools shaderc || apt-get install -y vulkan-tools libvulkan-dev glslang-tools shaderc

    # 3. UMGEBUNGSVARIABLEN SYSTEMWEIT REGISTRIEREN
    echo -e "${BLUE}[->] Konfiguriere Umgebungpfade für CUDA und Vulkan...${NC}"
    export PATH=/usr/bin:/usr/local/cuda/bin:${PATH}
    export LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:/usr/local/cuda/lib64:${LD_LIBRARY_PATH}
    
    if ! grep -q "/usr/local/cuda/bin" ~/.bashrc; then
        echo 'export PATH=/usr/bin:/usr/local/cuda/bin:${PATH}' >> ~/.bashrc
        echo 'export LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:/usr/local/cuda/lib64:${LD_LIBRARY_PATH}' >> ~/.bashrc
    fi
}

# =========================================================================
# FUNKTION 3: GIT SUBMODULE REPARATUR (SICHERES RE-INITIALISIEREN)
# =========================================================================
sync_submodules() {
    echo -e "\n${GREEN}[*] Repariere und lade fehlende Git-Submodules (ggml)...${NC}"
    if [ -d ".git" ] || [ -f "../.git" ]; then
        git submodule init
        git submodule update --init --recursive --force
    else
        echo -e "${RED}[!] Fehler: Kein Git-Repository in diesem Ordner gefunden!${NC}"
        echo -e "${YELLOW}Versuche den ggml-Ordner manuell zu klonen...${NC}"
        if [ ! -d "ggml" ] || [ -z "$(ls -A ggml)" ]; then
            rm -rf ggml
            git clone https://github.com ggml
        fi
    fi
}
# =========================================================================
# FUNKTION 2: GRAFIK TREIBER, CUDA-TOOLS, MINICONDA & UV INTERNALS
# =========================================================================
install_graphics_sdks() {
    echo -e "\n${GREEN}[*] Bereinige alte Paketkonflikte vor der System-Installation...${NC}"
    dpkg --remove --force-remove-reinstreq crashdiagnosticlayer 2>/dev/null || true
    apt-get install -f -y

    echo -e "\n${GREEN}[*] Richte Repositories für Enterprise-CUDA & Vulkan ein...${NC}"
    apt-get install -y wget gnupg2 curl ca-certificates software-properties-common
    add-apt-repository -y universe
    apt-get update

    # 1. NETZWERK-INSTALLATION FÜR REALES CUDA & CUDA-TOOLS (Paperspace-Optimiert)
    echo -e "${BLUE}[->] Füge offizielles Nvidia Ubuntu Repository hinzu...${NC}"
    # Erkennt automatisch, ob Ubuntu 22.04 oder 24.04 läuft
    UBUNTU_VERSION=$(lsb_release -rs | tr -d '.')
    if [ "$UBUNTU_VERSION" != "2204" ] && [ "$UBUNTU_VERSION" != "2404" ]; then
        UBUNTU_VERSION="2204" # Sicherer Fallback
    fi
    
    rm -f cuda-keyring_1.1-1_all.deb
    wget -q "https://nvidia.com{UBUNTU_VERSION}/x86_64/cuda-keyring_1.1-1_all.deb"
    dpkg -i cuda-keyring_1.1-1_all.deb
    apt-get update

    echo -e "${BLUE}[->] Installiere CUDA Toolkit, Compiler (nvcc) und Developer-Tools...${NC}"
    # Installiert das komplette Toolkit inklusive Profilern, gdb und Entwickler-Bibliotheken
    apt-get install -y cuda-toolkit-12-4 cuda-command-line-tools-12-4 cuda-compiler-12-4

    # 2. VULKAN SDK & SHADER-COMPILER (GLSLC)
    echo -e "${BLUE}[->] Richte LunarG Vulkan Repository ein...${NC}"
    rm -f lunarg-signing-key-pub.asc
    curl -L -f -o lunarg-signing-key-pub.asc https://lunarg.com
    tee /etc/apt/trusted.gpg.d/lunarg.asc < lunarg-signing-key-pub.asc > /dev/null
    rm -f lunarg-signing-key-pub.asc

    wget -qO /etc/apt/sources.list.d/lunarg-vulkan.list "https://lunarg.com"
    apt-get update
    echo -e "${BLUE}[->] Installiere Vulkan SDK und Shaderc/glslc...${NC}"
    apt-get install -y vulkan-sdk glslang-tools shaderc || apt-get install -y vulkan-tools libvulkan-dev glslang-tools shaderc

    # 3. MINICONDA INSTALLATION (Isolierte Python-Umgebung)
    if [ ! -d "$HOME/miniconda" ]; then
        echo -e "${BLUE}[->] Lade und installiere Miniconda...${NC}"
        wget -q "https://anaconda.com" -O miniconda.sh
        bash miniconda.sh -b -p "$HOME/miniconda"
        rm -f miniconda.sh
        # In aktuellen Pfad laden
        source "$HOME/miniconda/bin/activate"
        "$HOME/miniconda/bin/conda" init bash
    else
        echo -e "${YELLOW}[!] Miniconda bereits unter $HOME/miniconda installiert.${NC}"
        source "$HOME/miniconda/bin/activate"
    fi

    # 4. ASTRAL UV INSTALLATION (Der ultraschnelle Paketmanager)
    echo -e "${BLUE}[->] Installiere Astral uv Paketmanager...${NC}"
    curl -LsSf https://astral.sh | sh
    # uv-Pfad sofort für dieses Skript verfügbar machen
    export PATH="$HOME/.local/bin:$PATH"

    # 5. ENVIRONMENT-PFADE FÜR DIENSTE & NEUSTARTS SICHERSTELLEN
    echo -e "${BLUE}[->] Schreibe finale Umgebungsvariablen in die .bashrc...${NC}"
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
# FUNKTION 3: GIT SUBMODULE REPARATUR (SICHERES RE-INITIALISIEREN)
# =========================================================================
sync_submodules() {
    echo -e "\n${GREEN}[*] Repariere und lade fehlende Git-Submodules (ggml)...${NC}"
    if [ -d ".git" ] || [ -f "../.git" ]; then
        git submodule init
        git submodule update --init --recursive --force
    else
        echo -e "${RED}[!] Fehler: Kein Git-Repository in diesem Ordner gefunden!${NC}"
        echo -e "${YELLOW}Versuche den ggml-Ordner manuell zu klonen...${NC}"
        if [ ! -d "ggml" ] || [ -z "$(ls -A ggml)" ]; then
            rm -rf ggml
            git clone https://github.com ggml
        fi
    fi
}
# =========================================================================
# FUNKTION 4: COMPILER PROZESS (MAXIMALER SUPPORT FÜR CLOUD-GPUS A4000 / RTX 5000)
# =========================================================================
build_project() {
    local use_gpu=$1
    echo -e "\n${GREEN}[*] Bereinige alten Build-Cache vollständig...${NC}"
    rm -rf build/ CMakeFiles/ CMakeCache.txt Makefile cmake_install.cmake
    
    echo -e "\n${GREEN}[*] Konfiguriere CMake Build-Pipeline...${NC}"
    if [ "$use_gpu" = "true" ]; then
        echo -e "${YELLOW}Aktiviere HIGH-PERFORMANCE HYBRID-BUILD: CUDA + Vulkan...${NC}"
        
        # Absolute Pfade für Paperspace erzwingen
        export CUDA_HOME=/usr/local/cuda
        export PATH=/usr/local/cuda/bin:$HOME/miniconda/bin:$HOME/.local/bin:${PATH}
        export LD_LIBRARY_PATH=/usr/local/cuda/lib64:/usr/local/cuda/targets/x86_64-linux/lib:${LD_LIBRARY_PATH}
        
        # Nutzen der A4000/RTX5000 Ampere/Turing Kerne via CMake-Flags
        cmake -B build \
            -DGGML_CUDA=ON \
            -DGGML_VULKAN=ON \
            -DCUDAToolkit_ROOT=/usr/local/cuda \
            -DCUDAToolkit_INCLUDE_DIR=/usr/local/cuda/include \
            -DCUDA_CUDART=/usr/local/cuda/lib64/libcudart.so \
            -DCMAKE_BUILD_TYPE=Release
    else
        echo -e "${YELLOW}Aktiviere REINEN CPU-BUILD (Sicherer Modus)...${NC}"
        cmake -B build \
            -DGGML_CUDA=OFF \
            -DGGML_VULKAN=OFF \
            -DCMAKE_BUILD_TYPE=Release
    fi

    echo -e "\n${GREEN}[*] Starte Kompiliervorgang auf allen verfügbaren CPU-Kernen...${NC}"
    cmake --build build --config Release --parallel $(nproc)
}

# =========================================================================
# FUNKTION 5: MODELL AUTOMATION (QWEN3 MULTILINGUAL TTS)
# =========================================================================
download_model() {
    echo -e "\n${GREEN}[*] Prüfe Modell-Verzeichnis und starte Download...${NC}"
    MODEL_DIR="./models"
    mkdir -p "$MODEL_DIR"

    if [ ! -f "$MODEL_DIR/Qwen3-1.7B-Multilingual-TTS.f16.gguf" ]; then
        wget --progress=bar:force -O "$MODEL_DIR/Qwen3-1.7B-Multilingual-TTS.f16.gguf" \
        "https://huggingface.co"
    else
        echo -e "${YELLOW}[!] Info: Modell-Datei existiert bereits vollständig unter $MODEL_DIR.${NC}"
    fi
}

# =========================================================================
# FUNKTION 6: LOKALEN API SERVER STARTEN (CONDA + UV INTEGRATION)
# =========================================================================
start_server() {
    echo -e "\n${GREEN}[*] Starte bkg-qwen-tts API Server...${NC}"
    
    # Pfade für Runtime-Dienste bereitstellen
    export CUDA_HOME=/usr/local/cuda
    export PATH=/usr/local/cuda/bin:$HOME/miniconda/bin:$HOME/.local/bin:${PATH}
    export LD_LIBRARY_PATH=/usr/local/cuda/lib64:/usr/local/cuda/targets/x86_64-linux/lib:${LD_LIBRARY_PATH}

    # Aktiviert die Miniconda Basis-Umgebung für eventuelle Python-Abhängigkeiten
    if [ -f "$HOME/miniconda/bin/activate" ]; then
        source "$HOME/miniconda/bin/activate"
    fi

    if [ -f "./build/bin/bkg-qwen-tts-server" ]; then
        ./build/bin/bkg-qwen-tts-server -m ./models/Qwen3-1.7B-Multilingual-TTS.f16.gguf --port 1234
    elif [ -f "./build/bkg-qwen-tts-server" ]; then
        ./build/bkg-qwen-tts-server -m ./models/Qwen3-1.7B-Multilingual-TTS.f16.gguf --port 1234
    else
        echo -e "${RED}[!] Fehler: Die ausführbare Server-Datei wurde nicht gefunden! Bitte kompiliere das Projekt zuerst (Option 5 oder 6).${NC}"
        exit 1
    fi
}

# =========================================================================
# STRUKTURIERTE LOGIK-WEICHE NACH NUTZEREINGABE
# =========================================================================
case $OPTION in
    1) install_basis_tools; install_graphics_sdks; sync_submodules; build_project "true"; download_model ;;
    2) install_basis_tools ;;
    3) install_graphics_sdks ;;
    4) sync_submodules ;;
    5) build_project "true" ;;
    6) build_project "false" ;;
    7) download_model ;;
    8) start_server ;;
    9) echo "Skript beendet."; exit 0 ;;
    *) echo -e "${RED}Ungültige Auswahl. Bitte starte das Skript neu.${NC}"; exit 1 ;;
esac

echo -e "\n${GREEN}=========================================================================${NC}"
echo -e "${GREEN}  AKTION ERFOLGREICH BEENDET!                                            ${NC}"
echo -e "${GREEN}=========================================================================${NC}"
