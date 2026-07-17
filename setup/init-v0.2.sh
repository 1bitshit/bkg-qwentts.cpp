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
    echo -e "${BLUE}    bkg-qwen-tts.cpp - ULTIMATIVES INTERAKTIVES CONTAINER-MASTER-MENÜ    ${NC}"
    echo -e "${BLUE}=========================================================================${NC}"
}

show_header
echo "Bitte wähle die gewünschte Installations-Kombination aus:"
echo -e "${YELLOW}[KOMPLETTE SYSTEME]${NC}"
echo "1) ALLES VON NULL AUF (Build-Tools + CUDA-Fix + Vulkan + Submodules + Build + Model)"
echo -e "${YELLOW}[EINZELNE BAUSTEINE]${NC}"
echo "2) NUR BASIS BUILD-TOOLS & SYSTEM-LIBS (CMake, GCC, Python-Dev, Audio-Libs etc.)"
echo "3) NUR GRAFIK-TREIBER & SDKS (Abhängigkeiten fixen + Vulkan-Tools + glslc)"
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
# FUNKTION 1: BASIS BUILD-TOOLS & SYSTEM-BIBLIOTHEKEN (LÜCKENLOS)
# =========================================================================
install_basis_tools() {
    echo -e "\n${GREEN}[*] Installiere lückenlose Build-Tools, Compiler und Python-Pakete...${NC}"
    apt-get update
    apt-get install -y \
        build-essential cmake make gcc g++ git wget gnupg2 curl ca-certificates \
        software-properties-common pkg-config libtool autoconf automake \
        python3 python3-pip python3-dev python3-venv libasound2-dev \
        libjack-jackd2-dev portaudio19-dev ffmpeg unzip tar
    add-apt-repository -y universe
    apt-get update
}
# =========================================================================
# FUNKTION 2: GRAFIK TREIBER & SDKS (BLOCKADE-FREI FÜR CLOUD-CONTAINER)
# =========================================================================
install_graphics_sdks() {
    echo -e "\n${GREEN}[*] Behebe blockierte Paketabhängigkeiten im Container...${NC}"
    apt-get update
    
    # 1. Erzwinge das Bereinigen defekter Paketzustände (repariert den Fehler)
    apt-get install -f -y
    
    # 2. CUDA-Compiler OHNE Treiber-Abhängigkeiten installieren
    echo -e "${BLUE}[->] Installiere reines CUDA-Toolkit (Minimalversion ohne Treiber)...${NC}"
    apt-get install -y --no-install-recommends cuda-toolkit-12-4 || apt-get install -y --no-install-recommends nvidia-cuda-toolkit || true
    
    # Fallback: Prüfen, ob das Container-eigene CUDA existiert
    if ! command -v nvcc &> /dev/null; then
        echo -e "${YELLOW}[!] APT Treiber-Paket blockiert. Nutze vorinstalliertes Container-CUDA...${NC}"
        if [ -d "/usr/local/cuda/bin" ]; then
            export PATH=/usr/local/cuda/bin:${PATH}
            export LD_LIBRARY_PATH=/usr/local/cuda/lib64:${LD_LIBRARY_PATH}
            echo -e "${GREEN}[+] CUDA-Pfad wurde erfolgreich geladen!${NC}"
        fi
    fi

    # 3. VULKAN OHNE TREIBER-OVERHEAD INSTALLIEREN
    echo -e "${BLUE}[->] Installiere Vulkan-Entwicklerwerkzeuge und glslc...${NC}"
    apt-get install -y --no-install-recommends libvulkan-dev glslang-tools shaderc glslc || apt-get install -y --no-install-recommends libvulkan-dev glslang-tools shaderc
}

# =========================================================================
# FUNKTION 3: GIT SUBMODULE REPARATUR
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
# FUNKTION 4: COMPILER PROZESS (CONTAINER-PFADE ERZWINGEN)
# =========================================================================
build_project() {
    local use_gpu=$1
    echo -e "\n${GREEN}[*] Bereinige alten Build-Cache vollständig...${NC}"
    rm -rf build/ CMakeFiles/ CMakeCache.txt Makefile cmake_install.cmake
    
    echo -e "\n${GREEN}[*] Konfiguriere CMake Build-Pipeline...${NC}"
    if [ "$use_gpu" = "true" ]; then
        echo -e "${YELLOW}Aktiviere PARALLEL-BUILD: CUDA + Vulkan Hybrid-Modus...${NC}"
        
        # Cloud-Pfade priorisieren
        export CUDA_HOME=/usr/local/cuda
        export PATH=/usr/local/cuda/bin:${PATH}
        export LD_LIBRARY_PATH=/usr/local/cuda/lib64:/usr/local/cuda/targets/x86_64-linux/lib:${LD_LIBRARY_PATH}
        
        cmake -B build \
            -DGGML_CUDA=ON \
            -DGGML_VULKAN=ON \
            -DCUDAToolkit_ROOT=/usr/local/cuda \
            -DCMAKE_BUILD_TYPE=Release
    else
        echo -e "${YELLOW}Aktiviere REINEN CPU-BUILD...${NC}"
        cmake -B build \
            -DGGML_CUDA=OFF \
            -DGGML_VULKAN=OFF \
            -DCMAKE_BUILD_TYPE=Release
    fi

    echo -e "\n${GREEN}[*] Starte Kompiliervorgang auf allen verfügbaren CPU-Kernen...${NC}"
    cmake --build build --config Release --parallel $(nproc)
}
# =========================================================================
# FUNKTION 5: MODELL AUTOMATION
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
# FUNKTION 6: LOKALEN API SERVER STARTEN
# =========================================================================
start_server() {
    echo -e "\n${GREEN}[*] Starte bkg-qwen-tts API Server...${NC}"
    export CUDA_HOME=/usr/local/cuda
    export PATH=/usr/local/cuda/bin:${PATH}
    export LD_LIBRARY_PATH=/usr/local/cuda/lib64:/usr/local/cuda/targets/x86_64-linux/lib:${LD_LIBRARY_PATH}

    if [ -f "./build/bin/bkg-qwen-tts-server" ]; then
        ./build/bin/bkg-qwen-tts-server -m ./models/Qwen3-1.7B-Multilingual-TTS.f16.gguf --port 1234
    elif [ -f "./build/bkg-qwen-tts-server" ]; then
        ./build/bkg-qwen-tts-server -m ./models/Qwen3-1.7B-Multilingual-TTS.f16.gguf --port 1234
    else
        echo -e "${RED}[!] Fehler: Die ausführbare Server-Datei wurde nicht gefunden! Bitte kompiliere das Projekt zuerst (Option 5).${NC}"
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

