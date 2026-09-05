#!/bin/bash
# Mic Noise Canceller - macOS/Linux Installer
# Downloads the latest release, extracts it, and opens Chrome's extensions page.

set -e

REPO="mohamedmoamen8/mic-noise-canceller"
TMP_ZIP="/tmp/mic-noise-canceller.zip"
INSTALL_DIR="$HOME/.local/share/mic-noise-canceller"

echo "============================================"
echo "  Mic Noise Canceller - Installer"
echo "============================================"
echo ""

echo "Downloading latest release from GitHub..."
curl -sL "https://github.com/${REPO}/releases/latest/download/mic-noise-canceller.zip" -o "$TMP_ZIP"

if [ ! -s "$TMP_ZIP" ]; then
    echo "ERROR: Failed to download release. Check your internet connection."
    exit 1
fi

echo "Extracting extension files..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
unzip -o "$TMP_ZIP" -d "$INSTALL_DIR"

echo ""
echo "Opening Chrome extensions page..."
echo ""
echo "Instructions:"
echo "  1. Enable 'Developer mode' (toggle in the top-right)"
echo "  2. Click 'Load unpacked'"
echo "  3. Select the folder: $INSTALL_DIR"
echo "  4. Toggle 'Noise reduction' on in the popup"
echo ""

if command -v google-chrome &>/dev/null; then
    google-chrome "chrome://extensions/" &
elif command -v chromium-browser &>/dev/null; then
    chromium-browser "chrome://extensions/" &
elif command -v open &>/dev/null; then
    open "chrome://extensions/"
fi

echo ""
echo "Install folder: $INSTALL_DIR"
echo "Done!"
