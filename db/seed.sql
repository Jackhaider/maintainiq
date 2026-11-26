-- MaintainIQ demo data. Run after schema.sql (npm run db:setup runs both).
-- Dates are relative to the day you run it, so the dashboard always shows the last six months.
-- Users get a placeholder password hash here; scripts/db-setup.js replaces it with a bcrypt
-- hash of SEED_PASSWORD, so no password (plain or hashed) is stored in this file.
-- All names and companies below are fictional.

INSERT INTO roles (id, name, description) VALUES
  (1, 'operator',   'Runs machines on one production line; raises requests and records downtime and energy'),
  (2, 'supervisor', 'Oversees every line; manages work orders, users and reports');

INSERT INTO production_lines (id, code, name, location) VALUES
  (1, 'PL-PRS', 'Press Shop',          'Plant 1 - Bay A'),
  (2, 'PL-CNC', 'CNC Machining Cell',  'Plant 1 - Bay B'),
  (3, 'PL-ASM', 'Final Assembly',      'Plant 2 - Bay C'),
  (4, 'PL-PNT', 'Paint & Coating',     'Plant 2 - Bay D');

INSERT INTO users (id, role_id, production_line_id, full_name, email, password_hash) VALUES
  (1, 2, NULL, 'Priya Kulkarni',  'supervisor@maintainiq.demo', '!'),
  (2, 1, 1,    'Rahul Deshmukh',  'operator@maintainiq.demo',   '!'),
  (3, 1, 2,    'Sneha Patil',     'sneha.patil@maintainiq.demo','!'),
  (4, 1, 3,    'Imran Shaikh',    'imran.shaikh@maintainiq.demo','!'),
  (5, 1, 4,    'Anita Joshi',     'anita.joshi@maintainiq.demo','!'),
  (6, 2, NULL, 'Vikram Rao',      'vikram.rao@maintainiq.demo', '!');

INSERT INTO machines (id, production_line_id, asset_tag, name, machine_type, manufacturer, rated_power_kw, status, installed_on) VALUES
  (1,  1, 'PRS-001', 'Hydraulic Press 400T',      'Hydraulic press',   'Pashan Fluid Power',   75.00, 'running',     '2019-04-12'),
  (2,  1, 'PRS-002', 'Servo Press 250T',          'Servo press',       'Deccan Machine Works', 55.00, 'running',     '2021-08-03'),
  (3,  1, 'PRS-003', 'Blanking Line Feeder',      'Coil feeder',       'Sahyadri Automation',  22.00, 'maintenance', '2017-11-20'),
  (4,  2, 'CNC-101', '5-Axis Machining Centre',   'CNC mill',          'Precision Tools India',30.00, 'running',     '2020-02-17'),
  (5,  2, 'CNC-102', 'CNC Turning Centre',        'CNC lathe',         'Precision Tools India',18.50, 'idle',        '2018-06-30'),
  (6,  2, 'CNC-103', 'Horizontal Boring Mill',    'Boring mill',       'Western Heavy Eng.',   45.00, 'running',     '2016-09-14'),
  (7,  3, 'ASM-201', 'Robotic Welding Cell',      'Welding robot',     'Indra Robotics',       15.00, 'running',     '2022-01-10'),
  (8,  3, 'ASM-202', 'Torque Tightening Station', 'Assembly station',  'Indra Robotics',        7.50, 'down',        '2022-01-10'),
  (9,  3, 'ASM-203', 'Overhead Conveyor',         'Conveyor',          'Konkan Conveyors',     11.00, 'running',     '2015-05-25'),
  (10, 4, 'PNT-301', 'Pre-treatment Tunnel',      'Washer',            'Coatex Systems',       37.00, 'running',     '2019-10-01'),
  (11, 4, 'PNT-302', 'Powder Coating Booth',      'Spray booth',       'Coatex Systems',       22.00, 'running',     '2019-10-01'),
  (12, 4, 'PNT-303', 'Curing Oven',               'Industrial oven',   'Thermal Process Co.',  90.00, 'running',     '2018-03-08');

-- Work orders: a realistic mix of open, assigned, in-progress and closed jobs.
INSERT INTO work_orders (id, machine_id, requested_by, assigned_to, title, description, order_type, priority, status, due_date, closed_at, created_at) VALUES
  (1,  3,  2, 2,    'Feeder rollers slipping',            'Coil slips on entry rollers during high-speed runs.',         'corrective', 'high',     'in_progress', CURDATE() + INTERVAL 2 DAY,  NULL,                          NOW() - INTERVAL 3 DAY),
  (2,  8,  4, 4,    'Torque station calibration failure', 'Station rejects every third bolt; sensor drift suspected.',     'corrective', 'critical', 'assigned',    CURDATE() + INTERVAL 1 DAY,  NULL,                          NOW() - INTERVAL 1 DAY),
  (3,  1,  1, 2,    'Quarterly hydraulic oil change',     'Replace hydraulic oil and filters per PM schedule.',           'preventive', 'medium',   'closed',      CURDATE() - INTERVAL 20 DAY, NOW() - INTERVAL 21 DAY,       NOW() - INTERVAL 30 DAY),
  (4,  12, 5, NULL, 'Oven temperature overshoot',         'Zone 2 reads 15 C above set point at start-up.',              'corrective', 'high',     'open',        CURDATE() + INTERVAL 3 DAY,  NULL,                          NOW() - INTERVAL 6 HOUR),
  (5,  4,  1, 3,    'Spindle vibration inspection',       'Monthly vibration analysis on main spindle.',                  'inspection', 'low',      'closed',      CURDATE() - INTERVAL 12 DAY, NOW() - INTERVAL 13 DAY,       NOW() - INTERVAL 15 DAY),
  (6,  7,  4, 4,    'Welding tip replacement',            'Tip wear above limit on robot 2.',                             'preventive', 'medium',   'closed',      CURDATE() - INTERVAL 40 DAY, NOW() - INTERVAL 41 DAY,       NOW() - INTERVAL 44 DAY),
  (7,  9,  4, NULL, 'Conveyor chain noise',               'Grinding noise near station 4.',                               'corrective', 'medium',   'open',        CURDATE() + INTERVAL 5 DAY,  NULL,                          NOW() - INTERVAL 2 DAY),
  (8,  10, 1, 5,    'Nozzle cleaning - pre-treatment',    'Scheduled descaling of spray nozzles.',                        'preventive', 'low',      'assigned',    CURDATE() + INTERVAL 7 DAY,  NULL,                          NOW() - INTERVAL 1 DAY),
  (9,  6,  3, 3,    'Boring bar chatter',                 'Surface finish out of tolerance on housing bores.',            'corrective', 'high',     'closed',      CURDATE() - INTERVAL 60 DAY, NOW() - INTERVAL 62 DAY,       NOW() - INTERVAL 65 DAY),
  (10, 2,  2, 2,    'Servo drive fault E-217',            'Drive tripped twice on overcurrent.',                          'corrective', 'critical', 'closed',      CURDATE() - INTERVAL 90 DAY, NOW() - INTERVAL 92 DAY,       NOW() - INTERVAL 93 DAY),
  (11, 3,  1, 2,    'Feeder encoder replacement',         'Encoder count drifting; replace and re-teach.',                'corrective', 'high',     'closed',      CURDATE() - INTERVAL 110 DAY,NOW() - INTERVAL 112 DAY,      NOW() - INTERVAL 115 DAY),
  (12, 11, 5, 5,    'Booth filter change',                'Pressure drop across filters above 250 Pa.',                   'preventive', 'medium',   'in_progress', CURDATE() + INTERVAL 1 DAY,  NULL,                          NOW() - INTERVAL 2 DAY),
  (13, 5,  3, NULL, 'Chuck jaw wear',                     'Parts slipping in chuck on heavy cuts.',                       'corrective', 'medium',   'open',        CURDATE() + INTERVAL 4 DAY,  NULL,                          NOW() - INTERVAL 10 HOUR),
  (14, 8,  4, 4,    'Torque controller firmware update',  'Vendor bulletin recommends firmware 4.2.',                     'preventive', 'low',      'closed',      CURDATE() - INTERVAL 130 DAY,NOW() - INTERVAL 131 DAY,      NOW() - INTERVAL 140 DAY),
  (15, 12, 1, 5,    'Burner inspection',                  'Annual burner and flame safety inspection.',                   'inspection', 'high',     'closed',      CURDATE() - INTERVAL 150 DAY,NOW() - INTERVAL 151 DAY,      NOW() - INTERVAL 155 DAY),
  (16, 1,  2, NULL, 'Hydraulic hose weeping',             'Minor leak at cylinder 2 return hose.',                        'corrective', 'medium',   'open',        CURDATE() + INTERVAL 2 DAY,  NULL,                          NOW() - INTERVAL 4 HOUR);

-- Downtime: 96 historical events spread over ~6 months. Machines 3 and 8 are
-- deliberately unreliable so the "above-average downtime" report has something to find.
INSERT INTO downtime_logs (machine_id, reported_by, reason_category, description, started_at, ended_at)
WITH RECURSIVE seq (n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 96
), events AS (
  SELECT n,
         CASE WHEN MOD(n, 4) = 0 THEN 3
              WHEN MOD(n, 3) = 0 THEN 8
              ELSE 1 + MOD(n * 7, 12) END                       AS machine_id,
         ELT(1 + MOD(n, 5), 'mechanical', 'electrical', 'material', 'changeover', 'other') AS reason,
         DATE_ADD(DATE_SUB(CAST(CURDATE() AS DATETIME), INTERVAL (n * 2 - 1) DAY), INTERVAL (6 + MOD(n * 5, 12)) HOUR) AS started_at,
         20 + MOD(n * 37, 220)                                   AS minutes
  FROM seq
)
SELECT e.machine_id,
       COALESCE((SELECT u.id FROM users u JOIN machines m ON m.production_line_id = u.production_line_id
                 WHERE m.id = e.machine_id ORDER BY u.id LIMIT 1), 1),
       e.reason,
       CONCAT('Logged ', e.reason, ' stoppage'),
       e.started_at,
       e.started_at + INTERVAL e.minutes MINUTE
FROM events e;

-- One stoppage that is still ongoing (no end time yet).
INSERT INTO downtime_logs (machine_id, work_order_id, reported_by, reason_category, description, started_at, ended_at)
VALUES (8, 2, 4, 'electrical', 'Torque station stopped - waiting for calibration', NOW() - INTERVAL 5 HOUR, NULL);

-- Energy: one reading per machine per day for the last 180 days.
-- kWh = rated power x hours run x a load factor that varies by machine and day.
INSERT INTO energy_readings (machine_id, recorded_by, reading_date, kwh)
WITH RECURSIVE days (d) AS (
  SELECT 0 UNION ALL SELECT d + 1 FROM days WHERE d < 179
)
SELECT m.id,
       COALESCE((SELECT u.id FROM users u WHERE u.production_line_id = m.production_line_id ORDER BY u.id LIMIT 1), 1),
       CURDATE() - INTERVAL days.d DAY,
       ROUND(m.rated_power_kw * (12 + MOD(m.id * 3 + days.d, 8)) * (0.55 + MOD(m.id + days.d * 7, 30) / 100), 2)
FROM machines m CROSS JOIN days;

INSERT INTO maintenance_notes (work_order_id, author_id, note, created_at) VALUES
  (1,  2, 'Cleaned rollers and checked pressure. Slip reduced but still present above 40 m/min.', NOW() - INTERVAL 2 DAY),
  (1,  1, 'Ordered replacement polyurethane roller set; ETA tomorrow.',                          NOW() - INTERVAL 1 DAY),
  (2,  4, 'Sensor offset is 3.2 Nm. Calibration rig booked for morning shift.',                  NOW() - INTERVAL 20 HOUR),
  (3,  2, 'Oil and both filters replaced. 180 L used. Pressure test OK.',                        NOW() - INTERVAL 21 DAY),
  (5,  3, 'Vibration 2.1 mm/s RMS, within limit. No action needed.',                             NOW() - INTERVAL 13 DAY),
  (6,  4, 'Tips replaced on both guns, weld test coupons passed.',                               NOW() - INTERVAL 41 DAY),
  (9,  3, 'Replaced boring insert and rebalanced bar. Finish back to Ra 1.6.',                   NOW() - INTERVAL 62 DAY),
  (10, 2, 'Replaced drive cooling fan; drive was overheating under load.',                       NOW() - INTERVAL 92 DAY),
  (11, 2, 'New encoder fitted and feeder re-taught.',                                            NOW() - INTERVAL 112 DAY),
  (12, 5, 'Filters removed; replacement set on site.',                                           NOW() - INTERVAL 1 DAY),
  (15, 5, 'Burner flame rods cleaned, ignition sequence verified.',                              NOW() - INTERVAL 151 DAY);
