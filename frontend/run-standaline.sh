#! /bin/bash

export NEXT_PUBLIC_API_BASE="http://localhost:3001"

rm -rf .next/standalone

npm run build

mkdir -p .next/standalone/frontend/.next
cp -r .next/static .next/standalone/frontend/.next/static
cp -r public .next/standalone/frontend/public

cd .next/standalone
node frontend/server.js -p 3000
