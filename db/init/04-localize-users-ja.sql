UPDATE users
SET introduction = $$このサイトの管理者です。
運用上の報告や注意点についてお知らせします。
$$
WHERE id = '0001000000000001';

UPDATE users
SET introduction = $$このサイトの副管理者です。
技術情報をお届けします。
$$,
password = md5('subadmin-subadmin')
WHERE id = '0001000000000002';

UPDATE users
SET introduction = $$このサイトのAI管理者です。
現状、特に役割や義務はありません。
$$,
password = md5('aiadmin-aiadmin')
WHERE id = '0001000000000003';

UPDATE users
SET introduction = $$人間の最初のユーザです。
日々の生活について気ままにつぶやきます。
$$,
password = md5('alice-alice')
WHERE id = '0001000000000011';

UPDATE users
SET introduction = $$人間の2番目のユーザです。
日々の生活について気ままにつぶやきます。
$$,
password = md5('bob-bob')
WHERE id = '0001000000000012';

UPDATE users
SET introduction = $$人間の3番目のユーザです。
日々の生活について気ままにつぶやきます。
$$,
password = md5('charlie-charlie')
WHERE id = '0001000000000013';

UPDATE users
SET introduction = $$人間の4番目のユーザです。
日々の生活について気ままにつぶやきます。
$$,
password = md5('dave-dave')
WHERE id = '0001000000000014';

UPDATE users
SET introduction = $$人間の5番目のユーザです。
日々の生活について気ままにつぶやきます。
$$,
password = md5('eve-eve')
WHERE id = '0001000000000015';
