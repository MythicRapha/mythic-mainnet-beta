#!/bin/sh
# Mythic CLI Installer
# Usage: sh -c "$(curl -sSfL https://mythic.sh/install.sh)"
set -e

MYTHIC_CLI_VERSION="1.0.0"
INSTALL_DIR="${MYTHIC_HOME:-$HOME/.mythic}"
DOWNLOAD_URL="https://mythic.sh/releases/mythic-cli-${MYTHIC_CLI_VERSION}.tgz"

PURPLE='\033[0;35m'
GREEN='\033[0;32m'
RED='\033[0;31m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

main() {
    printf "\n"
    printf "${PURPLE}    ╱╲${NC}\n"
    printf "${PURPLE}   ╱  ╲${NC}\n"
    printf "${PURPLE}  ╱ ╱╲ ╲${NC}\n"
    printf "${PURPLE} ╱ ╱  ╲ ╲${NC}\n"
    printf "${PURPLE}╱ ╱    ╲ ╲${NC}\n"
    printf "${PURPLE}╲ ╲    ╱ ╱${NC}\n"
    printf "${PURPLE} ╲ ╲  ╱ ╱${NC}\n"
    printf "${PURPLE}  ╲ ╲╱ ╱${NC}\n"
    printf "${PURPLE}   ╲  ╱${NC}\n"
    printf "${PURPLE}    ╲╱${NC}\n"
    printf "\n"
    printf "${BOLD}${PURPLE}Installing Mythic CLI v${MYTHIC_CLI_VERSION}${NC}\n"
    printf "${GRAY}The AI-Native Blockchain${NC}\n"
    printf "\n"

    # Detect OS
    OS="$(uname -s)"
    case "$OS" in
        Linux*)  OS_NAME="linux";;
        Darwin*) OS_NAME="macos";;
        *)       printf "${RED}Unsupported OS: $OS${NC}\n"; exit 1;;
    esac

    # Detect architecture
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64)  ARCH_NAME="x64";;
        aarch64) ARCH_NAME="arm64";;
        arm64)   ARCH_NAME="arm64";;
        *)       printf "${RED}Unsupported architecture: $ARCH${NC}\n"; exit 1;;
    esac

    printf "  ${GRAY}OS: ${OS_NAME} (${ARCH_NAME})${NC}\n"

    # Check Node.js
    if ! command -v node >/dev/null 2>&1; then
        printf "\n"
        printf "  ${RED}Node.js is required but not found.${NC}\n"
        printf "  Install from: ${BOLD}https://nodejs.org${NC}\n"
        printf "\n"
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        printf "\n"
        printf "  ${RED}Node.js >= 18 required (found $(node -v))${NC}\n"
        printf "  Install from: ${BOLD}https://nodejs.org${NC}\n"
        printf "\n"
        exit 1
    fi

    printf "  ${GRAY}Node: $(node -v)${NC}\n"

    # Check npm
    if ! command -v npm >/dev/null 2>&1; then
        printf "\n"
        printf "  ${RED}npm is required but not found.${NC}\n"
        printf "\n"
        exit 1
    fi

    printf "  ${GRAY}npm: $(npm -v)${NC}\n"
    printf "\n"

    # Create mythic config directory
    mkdir -p "$INSTALL_DIR"

    # Download and install
    printf "  Downloading mythic-cli v${MYTHIC_CLI_VERSION}...\n"

    TMPDIR=$(mktemp -d)
    trap 'rm -rf "$TMPDIR"' EXIT

    if curl -sSfL "$DOWNLOAD_URL" -o "$TMPDIR/mythic-cli.tgz" 2>/dev/null; then
        printf "  Installing globally...\n"
        npm install -g "$TMPDIR/mythic-cli.tgz" --silent 2>/dev/null
    else
        printf "  ${GRAY}Tarball not available, trying npm registry...${NC}\n"
        npm install -g "@mythic/cli@${MYTHIC_CLI_VERSION}" --silent 2>/dev/null || {
            printf "  ${RED}Failed to install mythic-cli.${NC}\n"
            printf "  Try manual install:\n"
            printf "    git clone https://github.com/MythicL2/mythic-cli.git\n"
            printf "    cd mythic-cli && npm install && npm link\n"
            printf "\n"
            exit 1
        }
    fi

    printf "\n"

    # Verify installation
    if command -v mythic >/dev/null 2>&1; then
        printf "  ${GREEN}Mythic CLI installed successfully!${NC}\n"
    else
        # npm global bin might not be in PATH
        NPM_BIN="$(npm bin -g 2>/dev/null)"
        if [ -n "$NPM_BIN" ] && [ -f "$NPM_BIN/mythic" ]; then
            printf "  ${GREEN}Mythic CLI installed at: ${NPM_BIN}/mythic${NC}\n"
            printf "\n"
            printf "  ${GRAY}Add to your PATH:${NC}\n"

            SHELL_NAME="$(basename "$SHELL" 2>/dev/null || echo "sh")"
            case "$SHELL_NAME" in
                zsh)  PROFILE="~/.zshrc";;
                bash) PROFILE="~/.bashrc";;
                fish) PROFILE="~/.config/fish/config.fish";;
                *)    PROFILE="~/.profile";;
            esac

            printf "    echo 'export PATH=\"${NPM_BIN}:\$PATH\"' >> ${PROFILE}\n"
            printf "    source ${PROFILE}\n"
        else
            printf "  ${GREEN}Mythic CLI installed!${NC}\n"
        fi
    fi

    printf "\n"
    printf "  ${BOLD}Quick start:${NC}\n"
    printf "    mythic --version              Check installation\n"
    printf "    mythic help                   Show all commands\n"
    printf "    mythic config set --url https://rpc.mythic.sh\n"
    printf "    mythic balance                Show wallet balance\n"
    printf "\n"
    printf "  ${GRAY}Docs: https://mythic.sh/docs${NC}\n"
    printf "\n"
}

main "$@"
