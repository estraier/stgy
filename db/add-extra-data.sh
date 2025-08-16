#!/bin/bash

set -a
source .env
set +a

docker-compose exec -T db psql -U fakebook fakebook < db/extra-data/ai-agents.sql
docker-compose exec -T db psql -U fakebook fakebook < db/extra-data/volume-test.sql
