#!/bin/bash

# Build script for Meeting Scheduler

echo "🔨 Building Meeting Scheduler..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build main process
echo "⚙️  Building main process..."
npm run build:main

# Build renderer
echo "🎨 Building renderer..."
npm run build:renderer

# Package app
echo "📦 Packaging app for macOS..."
npm run dist:mac

echo "✅ Build complete! Check the release/ directory."

