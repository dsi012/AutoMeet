#!/bin/bash

# Development script for Meeting Scheduler

echo "🚀 Starting Meeting Scheduler in development mode..."

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Build main process
echo "🔨 Building main process..."
npm run build:main

# Start development
echo "✨ Starting app..."
npm run dev

