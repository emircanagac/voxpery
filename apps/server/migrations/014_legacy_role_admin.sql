-- Legacy role: use "admin" instead of "moderator" (owner / admin / member only).
UPDATE server_members SET role = 'admin' WHERE role = 'moderator';
