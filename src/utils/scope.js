const { query } = require('../config/db');
const { notFound, forbidden } = require('./httpError');
const { isSupervisor } = require('../middleware/auth');

/**
 * SQL condition limiting rows to machines the user may see.
 * Supervisors see every line; operators see only their own production line.
 * `alias` is the machines table alias in the calling query.
 */
function machineScope(user, alias = 'm') {
  if (isSupervisor(user)) return { clause: '1 = 1', params: [] };
  if (!user.productionLineId) return { clause: '1 = 0', params: [] };
  return { clause: `${alias}.production_line_id = ?`, params: [user.productionLineId] };
}

/** Load a machine, or throw 404 if it does not exist and 403 if the operator works on another line. */
async function getAccessibleMachine(user, machineId) {
  const rows = await query('SELECT id, production_line_id, name, asset_tag FROM machines WHERE id = ?', [machineId]);
  const machine = rows[0];
  if (!machine) throw notFound('Machine');
  if (!isSupervisor(user) && machine.production_line_id !== user.productionLineId) {
    throw forbidden('This machine belongs to another production line');
  }
  return machine;
}

module.exports = { machineScope, getAccessibleMachine };
