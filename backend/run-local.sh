#! /bin/bash

export BACKEND_PORT=3001
export DATABASE_HOST=localhost
export DATABASE_USER=fakebook
export DATABASE_PASSWORD=db_password
export DATABASE_NAME=fakebook
export DATABASE_PORT=5432
export CHOKIDAR_USEPOLLING=true
export REDIS_HOST=localhost
export REDIS_PORT=6379
export REDIS_PASSWORD=redis_password
export FRONTEND_ORIGIN=http://localhost:3000

npm run dev
