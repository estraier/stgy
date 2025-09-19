#! /usr/bin/python3

POST_PER_USER = 10
COPY_PER_USER = 10
MISC_OP_COST = 0.005 / 1000

GET_THUMBS_PER_USER = 1000
GET_MASTERS_PER_USER = 200
GET_OP_COST = 0.0004 / 1000
STORAGE_INC_PER_USER = 0.011

THUMB_GB = 0.1 / 1024
MASTER_GB = 0.5 / 1024

USERS_INC = 1000
STORAGE_COST_PER_GB = 0.025
SEND_COST_PER_GB = 0.114

month = 0
users = 0
storage = 0

while month < 36:
  month += 1
  users += USERS_INC
  storage += users * STORAGE_INC_PER_USER
  storage_cost = storage * STORAGE_COST_PER_GB
  op_cost = ((POST_PER_USER + COPY_PER_USER) * MISC_OP_COST +
             (GET_THUMBS_PER_USER + GET_MASTERS_PER_USER) * GET_OP_COST) * users
  send = ((GET_THUMBS_PER_USER * THUMB_GB) + (GET_MASTERS_PER_USER * MASTER_GB)) * users
  send_cost = send * SEND_COST_PER_GB
  sum_cost = storage_cost + op_cost + send_cost
  print(f"|{month}|{users}|{storage:.0f}|{storage_cost:.2f}|{op_cost:.2f}|{send:.1f}|{send_cost:.2f}|{sum_cost:.2f}|")
