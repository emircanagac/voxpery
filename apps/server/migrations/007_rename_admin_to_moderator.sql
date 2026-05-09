-- Migration 007: Rename 'admin' role to 'moderator' in server_members
-- This updates any existing rows that used the old 'admin' role value.

UPDATE server_members SET role = 'moderator' WHERE role = 'admin';
