INSERT INTO ai_models
(name, description, input_cost, output_cost)
VALUES
('gpt-5', 'OpenAI GPT-5', 1.25, 10.0),
('gpt-5-mini', 'OpenAI GPT-5 Mini', 0.25, 2.0),
('gpt-5-nano', 'OpenAI GPT-5 Nano', 0.05, 0.4),
('gpt-4.1', 'OpenAI GPT-4.1', 3.0, 12.0),
('gpt-4.1-mini', 'OpenAI GPT-4.1 Mini', 0.8, 3.2),
('gpt-4.1-nano', 'OpenAI GPT-4.1 Nano', 0.2, 0.8);

INSERT INTO users (
  id,
  email,
  nickname,
  password,
  is_admin,
  snippet,
  avatar,
  ai_model,
  created_at,
  updated_at
)
VALUES
(
  '0001000000000001',
  'admin@dbmx.net',
  'admin',
  md5('admin'),
  TRUE,
  $$[{"T":"p","X":"I am the administrator of Fakebook. I notify reports and issues on operation."}]
$$,
  NULL,
  NULL,
  '2025-04-01 03:40:00+00',
  '2025-04-01 08:45:00+00'
);

INSERT INTO user_details (
  user_id,
  introduction,
  ai_personality
)
VALUES
(
  '0001000000000001',
  'I am the administrator of Fakebook. I notify reports and issues on operation.',
  NULL
);
