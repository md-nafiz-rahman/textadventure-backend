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
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const allItemIds = new Set();
  rooms.forEach((r) => {
    (r.items || []).forEach((i) => allItemIds.add(i.id));
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
    });

    if (room.puzzle) {
      if (!room.puzzle.answer || room.puzzle.answer.trim() === '') {
        errors.push(`Room "${room.id}" has a puzzle with no answer.`);
      }
      if (!room.puzzle.hints || room.puzzle.hints.length === 0) {
        errors.push(`Room "${room.id}" has a puzzle with no hints.`);
      }
      if (room.puzzle.onSolve?.revealsItemId && !allItemIds.has(room.puzzle.onSolve.revealsItemId)) {
        errors.push(`Room "${room.id}"'s puzzle claims to reveal item "${room.puzzle.onSolve.revealsItemId}", but no such item was actually placed anywhere in the map.`);
      }
    }

    if (room.enemy) {
      if (room.enemy.onDefeat?.revealsItemId && !allItemIds.has(room.enemy.onDefeat.revealsItemId)) {
        errors.push(`Enemy "${room.enemy.id}" in room "${room.id}" claims to reveal item "${room.enemy.onDefeat.revealsItemId}", but no such item was actually placed anywhere in the map.`);
      }
    }
  });

  const revealTargets = new Set();
  rooms.forEach((r) => {
    if (r.puzzle?.onSolve?.revealsItemId) revealTargets.add(r.puzzle.onSolve.revealsItemId);
    if (r.enemy?.onDefeat?.revealsItemId) revealTargets.add(r.enemy.onDefeat.revealsItemId);
  });

  rooms.forEach((room) => {
    (room.items || []).forEach((item) => {
      if (item.hidden && !revealTargets.has(item.id)) {
        errors.push(`Item "${item.id}" in room "${room.id}" is marked hidden but nothing in the map ever reveals it.`);
      }
    });
  });

  const reachableRooms = new Set(roomIds.has(startRoomId) ? [startRoomId] : []);
  const obtainedItems = new Set();
  const revealedItemIds = new Set();
  const solvedPuzzles = new Set();
  const defeatedEnemies = new Set();

  let changed = true;
  while (changed) {
    changed = false;

    for (const roomId of reachableRooms) {
      const room = roomById.get(roomId);
      if (!room) continue;

      (room.items || []).forEach((item) => {
        const visible = !item.hidden || revealedItemIds.has(item.id);
        if (visible && !obtainedItems.has(item.id)) {
          obtainedItems.add(item.id);
          changed = true;
        }
      });

      if (room.puzzle && !solvedPuzzles.has(room.puzzle.id)) {
        solvedPuzzles.add(room.puzzle.id);
        changed = true;
        const revealed = room.puzzle.onSolve?.revealsItemId;
        if (revealed && allItemIds.has(revealed) && !revealedItemIds.has(revealed)) {
          revealedItemIds.add(revealed);
        }
      }

      if (room.enemy && !defeatedEnemies.has(room.enemy.id)) {
        const canDefeat = (room.enemy.defeatedByAnyOf || []).some((id) => obtainedItems.has(id));
        if (canDefeat) {
          defeatedEnemies.add(room.enemy.id);
          changed = true;
          const revealed = room.enemy.onDefeat?.revealsItemId;
          if (revealed && allItemIds.has(revealed) && !revealedItemIds.has(revealed)) {
            revealedItemIds.add(revealed);
          }
        }
      }

      (room.exits || []).forEach((exit) => {
        if (!roomIds.has(exit.roomId) || reachableRooms.has(exit.roomId)) return;

        let canPass = !exit.locked;
        if (exit.locked) {
          if (exit.requiredItemId && obtainedItems.has(exit.requiredItemId)) {
            canPass = true;
          } else if (room.puzzle?.onSolve?.unlocksExitDirection === exit.direction && solvedPuzzles.has(room.puzzle.id)) {
            canPass = true;
          } else if (room.enemy?.onDefeat?.unlocksExitDirection === exit.direction && defeatedEnemies.has(room.enemy.id)) {
            canPass = true;
          }
        }

        if (canPass) {
          reachableRooms.add(exit.roomId);
          changed = true;
        }
      });
    }
  }

  const unreachable = rooms.filter((r) => !reachableRooms.has(r.id));
  if (unreachable.length > 0) {
    errors.push(
      `These rooms can never actually be reached given the required items, puzzles, and enemies: ${unreachable.map((r) => r.id).join(', ')}. This usually means a key or unlock condition is placed behind the very door or challenge it's meant to open.`
    );
  }

  if (objective) {
    const { type, target } = objective;
    if (!Array.isArray(target) || target.length === 0) {
      errors.push('Objective target is empty.');
    } else if (type === 'reachRoom') {
      target.forEach((id) => {
        if (!roomIds.has(id)) errors.push(`Objective target room "${id}" does not exist.`);
        else if (!reachableRooms.has(id)) errors.push(`Objective target room "${id}" exists but is not actually reachable given the map's locks and dependencies.`);
      });
    } else if (type === 'collectItems') {
      target.forEach((id) => {
        if (!allItemIds.has(id)) errors.push(`Objective target item "${id}" does not exist.`);
        else if (!obtainedItems.has(id)) errors.push(`Objective target item "${id}" exists but is not actually obtainable given the map's locks and dependencies.`);
      });
    } else if (type === 'defeatEnemies') {
      const allEnemyIds = new Set(rooms.filter((r) => r.enemy).map((r) => r.enemy.id));
      target.forEach((id) => {
        if (!allEnemyIds.has(id)) errors.push(`Objective target enemy "${id}" does not exist.`);
        else if (!defeatedEnemies.has(id)) errors.push(`Objective target enemy "${id}" exists but is not actually defeatable given the map's locks and dependencies.`);
      });
    } else {
      errors.push(`Unknown objective type "${type}".`);
    }
  } else {
    errors.push('Missing objective.');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateMap };