#!/bin/bash

echo "Setting up example test suites..."

cd playwright
echo "Installing Playwright dependencies..."
npm install
npx playwright install chromium

cd cypress
echo "Installing Cypress dependencies..."
npm install

cd selenium
echo "Installing Selenium dependencies..."
npm install

echo "Done! All example test suites are ready."