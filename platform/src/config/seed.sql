-- ---------------------------------------------------------------------------
-- Thirdwave Platform — Seed Data
-- ---------------------------------------------------------------------------
-- Default roles, tool metadata, RBAC policies, and path access rules.
-- Idempotent: uses ON CONFLICT DO NOTHING.
-- ---------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Default Roles
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO roles (name, description) VALUES
  ('admin',       'Full access; manage users, roles, and policies'),
  ('developer',   'Write/read access to workspace; ask for shell and web ops'),
  ('team_leader', 'Broad read, limited write; approves agent actions in their scope'),
  ('readonly',    'View-only access; no write, shell, or web tools')
ON CONFLICT (name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Tool Metadata (17 tools)
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO tool_metadata (name, description, risky, category) VALUES
  ('bash',        'Execute shell commands',                TRUE,  'shell'),
  ('read',        'Read file contents',                    FALSE, 'filesystem'),
  ('write',       'Write/create files',                    TRUE,  'filesystem'),
  ('edit',        'Edit existing files',                   TRUE,  'filesystem'),
  ('apply_patch', 'Apply diff patches to files',           TRUE,  'filesystem'),
  ('multiedit',   'Edit multiple files at once',           TRUE,  'filesystem'),
  ('ls',          'List directory contents',               FALSE, 'filesystem'),
  ('glob',        'Search files by glob pattern',          FALSE, 'search'),
  ('grep',        'Search file contents by pattern',       FALSE, 'search'),
  ('codesearch',  'Semantic code search',                  FALSE, 'search'),
  ('webfetch',    'Fetch content from URLs',               TRUE,  'web'),
  ('websearch',   'Search the web',                        TRUE,  'web'),
  ('batch',       'Execute batch/parallel operations',     TRUE,  'agent'),
  ('plan',        'Create execution plans',                FALSE, 'agent'),
  ('task',        'Create and manage tasks',               TRUE,  'agent'),
  ('question',    'Ask clarifying questions',              FALSE, 'agent'),
  ('skill',       'Load and execute skills',               TRUE,  'agent')
ON CONFLICT (name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RBAC Policies (4 roles × 17 tools = 68 rows)
-- ═══════════════════════════════════════════════════════════════════════════
-- Decision types: allow = execute immediately | ask = approval popup + Slack | deny = block + log

-- Helper: insert policies by role name
DO $$
DECLARE
  r_admin       UUID;
  r_developer   UUID;
  r_team_leader UUID;
  r_readonly    UUID;
BEGIN
  SELECT id INTO r_admin       FROM roles WHERE name = 'admin';
  SELECT id INTO r_developer   FROM roles WHERE name = 'developer';
  SELECT id INTO r_team_leader FROM roles WHERE name = 'team_leader';
  SELECT id INTO r_readonly    FROM roles WHERE name = 'readonly';

  -- Admin: allow everything
  INSERT INTO tool_access_policies (tool_name, role_id, decision) VALUES
    ('bash',        r_admin, 'allow'), ('read',        r_admin, 'allow'),
    ('write',       r_admin, 'allow'), ('edit',        r_admin, 'allow'),
    ('apply_patch', r_admin, 'allow'), ('multiedit',   r_admin, 'allow'),
    ('ls',          r_admin, 'allow'), ('glob',        r_admin, 'allow'),
    ('grep',        r_admin, 'allow'), ('codesearch',  r_admin, 'allow'),
    ('webfetch',    r_admin, 'allow'), ('websearch',   r_admin, 'allow'),
    ('batch',       r_admin, 'allow'), ('plan',        r_admin, 'allow'),
    ('task',        r_admin, 'allow'), ('question',    r_admin, 'allow'),
    ('skill',       r_admin, 'allow')
  ON CONFLICT (tool_name, role_id) DO NOTHING;

  -- Developer: allow safe ops, ask for risky ones
  INSERT INTO tool_access_policies (tool_name, role_id, decision) VALUES
    ('bash',        r_developer, 'ask'),   ('read',        r_developer, 'allow'),
    ('write',       r_developer, 'allow'), ('edit',        r_developer, 'allow'),
    ('apply_patch', r_developer, 'allow'), ('multiedit',   r_developer, 'allow'),
    ('ls',          r_developer, 'allow'), ('glob',        r_developer, 'allow'),
    ('grep',        r_developer, 'allow'), ('codesearch',  r_developer, 'allow'),
    ('webfetch',    r_developer, 'ask'),   ('websearch',   r_developer, 'allow'),
    ('batch',       r_developer, 'ask'),   ('plan',        r_developer, 'allow'),
    ('task',        r_developer, 'allow'), ('question',    r_developer, 'allow'),
    ('skill',       r_developer, 'allow')
  ON CONFLICT (tool_name, role_id) DO NOTHING;

  -- Team Leader: allow reads, ask for writes
  INSERT INTO tool_access_policies (tool_name, role_id, decision) VALUES
    ('bash',        r_team_leader, 'ask'),   ('read',        r_team_leader, 'allow'),
    ('write',       r_team_leader, 'ask'),   ('edit',        r_team_leader, 'ask'),
    ('apply_patch', r_team_leader, 'ask'),   ('multiedit',   r_team_leader, 'ask'),
    ('ls',          r_team_leader, 'allow'), ('glob',        r_team_leader, 'allow'),
    ('grep',        r_team_leader, 'allow'), ('codesearch',  r_team_leader, 'allow'),
    ('webfetch',    r_team_leader, 'ask'),   ('websearch',   r_team_leader, 'allow'),
    ('batch',       r_team_leader, 'ask'),   ('plan',        r_team_leader, 'allow'),
    ('task',        r_team_leader, 'ask'),   ('question',    r_team_leader, 'allow'),
    ('skill',       r_team_leader, 'ask')
  ON CONFLICT (tool_name, role_id) DO NOTHING;

  -- Readonly: allow reads only, deny everything else
  INSERT INTO tool_access_policies (tool_name, role_id, decision) VALUES
    ('bash',        r_readonly, 'deny'),  ('read',        r_readonly, 'allow'),
    ('write',       r_readonly, 'deny'),  ('edit',        r_readonly, 'deny'),
    ('apply_patch', r_readonly, 'deny'),  ('multiedit',   r_readonly, 'deny'),
    ('ls',          r_readonly, 'allow'), ('glob',        r_readonly, 'allow'),
    ('grep',        r_readonly, 'allow'), ('codesearch',  r_readonly, 'allow'),
    ('webfetch',    r_readonly, 'deny'),  ('websearch',   r_readonly, 'deny'),
    ('batch',       r_readonly, 'deny'),  ('plan',        r_readonly, 'allow'),
    ('task',        r_readonly, 'deny'),  ('question',    r_readonly, 'allow'),
    ('skill',       r_readonly, 'deny')
  ON CONFLICT (tool_name, role_id) DO NOTHING;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Path Access Rules (per-role directory permissions)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r_admin       UUID;
  r_developer   UUID;
  r_team_leader UUID;
  r_readonly    UUID;
BEGIN
  SELECT id INTO r_admin       FROM roles WHERE name = 'admin';
  SELECT id INTO r_developer   FROM roles WHERE name = 'developer';
  SELECT id INTO r_team_leader FROM roles WHERE name = 'team_leader';
  SELECT id INTO r_readonly    FROM roles WHERE name = 'readonly';

  -- Admin: full access everywhere
  INSERT INTO path_access_rules (role_id, path_pattern, readable, writable, executable, priority) VALUES
    (r_admin, '/workspace/**',       TRUE, TRUE, TRUE,  10),
    (r_admin, '~/**',                TRUE, TRUE, TRUE,  10),
    (r_admin, '/etc/**',             TRUE, TRUE, TRUE,  10),
    (r_admin, '/root/**',            TRUE, TRUE, TRUE,  10),
    (r_admin, '**/.env*',            TRUE, TRUE, FALSE, 20),
    (r_admin, '**/node_modules/**',  TRUE, TRUE, TRUE,  5);

  -- Developer: workspace r/w/x, home r/w, no system dirs
  INSERT INTO path_access_rules (role_id, path_pattern, readable, writable, executable, priority) VALUES
    (r_developer, '/workspace/**',       TRUE, TRUE,  TRUE,  10),
    (r_developer, '~/**',                TRUE, TRUE,  FALSE, 10),
    (r_developer, '**/node_modules/**',  TRUE, FALSE, TRUE,  5);

  -- Team Leader: workspace r/w, home r
  INSERT INTO path_access_rules (role_id, path_pattern, readable, writable, executable, priority) VALUES
    (r_team_leader, '/workspace/**',  TRUE, TRUE,  FALSE, 10),
    (r_team_leader, '~/**',           TRUE, FALSE, FALSE, 10),
    (r_team_leader, '**/node_modules/**', TRUE, FALSE, FALSE, 5);

  -- Readonly: workspace read only
  INSERT INTO path_access_rules (role_id, path_pattern, readable, writable, executable, priority) VALUES
    (r_readonly, '/workspace/**', TRUE, FALSE, FALSE, 10);
END $$;
