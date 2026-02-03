CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

SELECT u.id, u.name, COUNT(p.id) as post_count
FROM users u
LEFT JOIN posts p ON u.id = p.user_id
GROUP BY u.id
ORDER BY post_count DESC;

SELECT DISTINCT person_name
FROM party_attendees
JOIN dog_owners ON party_attendees.person_id = dog_owners.owner_id
WHERE party_attendees.event_name = 'Who Let The Dogs Out Party'
  AND party_attendees.action = 'Let the dogs out';
