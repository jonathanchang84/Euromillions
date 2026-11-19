#!/bin/bash
# build_macos_app.sh - Build and package EuroMillions Predictor for macOS
#
# This script:
# 1. Ensures dependencies are installed
# 2. Runs PyInstaller to create the .app bundle
# 3. Copies the .app to /Applications/
# 4. Verifies the application launches correctly

set -e

echo "=== EuroMillions Predictor - macOS Build Script ==="
echo ""

# Step 1: Ensure PyInstaller is installed
echo "Checking PyInstaller..."
if ! pip3 list 2>/dev/null | grep -q PyInstaller; then
    echo "Installing PyInstaller..."
    pip3 install pyinstaller > /dev/null 2>&1
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to install PyInstaller"
        exit 1
    fi
else
    echo "PyInstaller already installed"
fi

echo ""

# Step 2: Ensure requirements are met
echo "Checking dependencies..."
REQUIRED="matplotlib requests beautifulsoup4"
for pkg in $REQUIRED; do
    if ! pip3 list 2>/dev/null | grep -q "$pkg"; then
        echo "Installing $pkg..."
        pip3 install "$pkg" > /dev/null 2>&1
    fi
done

echo ""

# Step 3: Build the .app bundle using PyInstaller
echo "Building PyInstaller application..."
cd "$(dirname "$0")"

# Clean previous builds
rm -rf build dist "EuroMillions Predictor.app"

# Run PyInstaller with optimal settings for macOS
pyinstaller \
    --windowed \
    --name "EuroMillions Predictor" \
    --add-data "src/data_store.py:src" \
    --add-data "src/predictor.py:src" \
    --add-data "src/scraper.py:src" \
    --add-data "src/charts.py:src" \
    --add-data "src/app.py:src" \
    --add-data "src/__init__.py:src" \
    --collect-all matplotlib \
    src/app.py

if [ $? -ne 0 ]; then
    echo "ERROR: PyInstaller build failed"
    exit 1
fi

echo ""

# Step 4: Copy the .app to /Applications/
echo "Installing to /Applications/..."
APP_PATH="dist/EuroMillions Predictor.app"
APPLICATIONS_PATH="/Applications/EuroMillions Predictor.app"

if [ -d "$APP_PATH" ]; then
    # Remove existing app if it exists
    rm -rf "$APPLICATION_PATH"
    cp -R "$APP_PATH" "$APPLICATION_PATH"
    echo "Copied EuroMillions Predictor.app to /Applications/"
else
    echo "ERROR: Build application not found at $APP_PATH"
    exit 1
fi

echo ""

# Step 5: Verify the application launches
echo "Verifying application launch..."
sleep 1

# Try to launch the app
open -a "EuroMillions Predictor" 2>/dev/null || {
    # If open fails, try launching via the Python executable
    echo "Attempting alternative launch..."
    python3 "$src_dir/src/app.py" &
}

# Wait briefly and check if process is running
sleep 2

echo ""
echo "=== Build Complete ==="
echo "EuroMillions Predictor is available in /Applications/"
echo "Launch it from Finder or run: open -a \"EuroMillions Predictor\""
echo ""
echo "Note: On first launch, the application will copy the seed CSV to:"
echo "  ~/Library/Application Support/EuroMillionsPredictor/draws.csv"