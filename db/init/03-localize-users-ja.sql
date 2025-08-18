UPDATE users
SET introduction = $$このサイトの管理者です。
運用上の報告や注意点についてお知らせします。
$$
WHERE id = '00000000-0000-0000-0001-000000000001';

UPDATE users
SET introduction = $$このサイトの副管理者です。
このアカウントはAIモデルと接続しています。
$$,
password = md5('subadmin-subadmin')
WHERE id = '00000000-0000-0000-0001-000000000002';

UPDATE users
SET introduction = $$人間の最初のユーザです。
日々の生活について気ままにつぶやきます。
$$,
password = md5('alice-alice')
WHERE id = '00000000-0000-0000-0001-000000000003';

UPDATE users
SET introduction = $$人間の2番目のユーザです。
日々の生活について気ままにつぶやきます。
$$,
password = md5('bob-bob')
WHERE id = '00000000-0000-0000-0001-000000000004';
