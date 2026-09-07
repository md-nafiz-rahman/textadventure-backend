function validateMap(map) {
  const errors = [];

  if (!map || typeof map !== 'object') {
    return { valid: false, errors: ['Map is not a valid object.'] };
  }

  const { title, startRoomId, objective, rooms } = map;

  if (!title) errors.push('Missing title.');
  if (!startRoomId) errors.push('Missing startRoomId.');
  if (!Array.isArray(rooms) || rooms.length === 0) {
    errors.push('Map must have at least one room.');
    return { valid: false, errors };
  }

  const roomIds = new Set(rooms.map((r) => r.id));
  const allItemIds = new Set();
  rooms.forEach((r) => {
    (r.items || []).forEach((i) => allItemIds.add(i.id));
    if (r.puzzle?.onSolve?.revealsItemId) allItemIds.add(r.puzzle.onSolve.revealsItemId);
    if (r.enemy?.onDefeat?.revealsItemId) allItemIds.add(r.enemy.onDefeat.revealsItemId);
  });

  if (!roomIds.has(startRoomId)) {
    errors.push(`startRoomId "${startRoomId}" does not match any room id.`);
  }

  if (roomIds.size !== rooms.length) {
    errors.push('Duplicate room ids found.');
  }

  rooms.forEach((room) => {
    if (!room.id) {
      errors.push('A room is missing an id.');
      return;
    }

    (room.exits || []).forEach((exit) => {
      if (!roomIds.has(exit.roomId)) {
        errors.push(`Room "${room.id}" has an exit "${exit.direction}" pointing to non-existent room "${exit.roomId}".`);
      }

      if (exit.locked) {
        const hasKeyItem = exit.requiredItemId && allItemIds.has(exit.requiredItemId);
        const unlockedByPuzzle = room.puzzle?.onSolve?.unlocksExitDirection === exit.direction;
        const unlockedByEnemy = room.enemy?.onDefeat?.unlocksExitDirection === exit.direction;

        if (!hasKeyItem && !unlockedByPuzzle && !unlockedByEnemy) {
          errors.push(`Room "${room.id}" has a locked exit "${exit.direction}" with no valid way to unlock it.`);
        }
      }
    });

    if (room.puzzle) {
      if (!room.puzzle.answer || room.puzzle.answer.trim() === '') {
        errors.push(`Room "${room.id}" has a puzzle with no answer.`);
      }
      if (!room.puzzle.hints || room.puzzle.hints.length === 0) {
        errors.push(`Room "${room.id}" has a puzzle with no hints.`);
      }
    }

    if (room.enemy) {
      const hasValidWeakness = room.enemy.defeatedByAnyOf?.some((itemId) => allItemIds.has(itemId));
      if (!hasValidWeakness) {
        errors.push(`Enemy "${room.enemy.id}" in room "${room.id}" has no obtainable item in defeatedByAnyOf.`);
      }
    }
  });

  if (roomIds.has(startRoomId)) {
    const visited = new Set([startRoomId]);
    const queue = [startRoomId];
    const roomById = new Map(rooms.map((r) => [r.id, r]));

    while (queue.length > 0) {
      const currentId = queue.shift();
      const currentRoom = roomById.get(currentId);
      if (!currentRoom) continue;

      (currentRoom.exits || []).forEach((exit) => {
        if (roomIds.has(exit.roomId) && !visited.has(exit.roomId)) {
          visited.add(exit.roomId);
          queue.push(exit.roomId);
        }
      });
    }

    const unreachable = rooms.filter((r) => !visited.has(r.id));
    if (unreachable.length > 0) {
      errors.push(`Unreachable rooms found: ${unreachable.map((r) => r.id).join(', ')}.`);
    }
  }

  if (objective) {
    const { type, target } = objective;
    if (!Array.isArray(target) || target.length === 0) {
      errors.push('Objective target is empty.');
    } else if (type === 'reachRoom') {
      target.forEach((id) => { if (!roomIds.has(id)) errors.push(`Objective target room "${id}" does not exist.`); });
    } else if (type === 'collectItems') {
      target.forEach((id) => { if (!allItemIds.has(id)) errors.push(`Objective target item "${id}" does not exist.`); });
    } else if (type === 'defeatEnemies') {
      const allEnemyIds = new Set(rooms.filter((r) => r.enemy).map((r) => r.enemy.id));
      target.forEach((id) => { if (!allEnemyIds.has(id)) errors.push(`Objective target enemy "${id}" does not exist.`); });
    } else {
      errors.push(`Unknown objective type "${type}".`);
    }
  } else {
    errors.push('Missing objective.');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateMap };