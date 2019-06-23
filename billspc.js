// save file structure
const gen1Save = {
	partyOffset: 0x2f2c,
	partyHeaderSize: 8,
	partyPkmnSize: 0x2c,
	pcOffsets: [0x4000, 0x6000],
	numBoxes: 12, // 6 per bank
	activeBoxOffset: 0x30d6, // contents of current box (no header?)
	boxSize: 0x462,
	boxHeaderSize: 0x16,
	boxPkmnSize: 0x21,
};
const gen2Save = {
	partyOffset: 0x1a65,
	partyHeaderSize: 8,
	partyPkmnSize: 0x30,
	pcOffsets: [0x4000, 0x6000],
	numBoxes: 14, // 7 per bank
	boxSize: 0x450,
	boxHeaderSize: 0x16,
	boxPkmnSize: 0x20,
};

// returns {hp, attack, defense, speed, special}, range 0-65535.
// the raw values are little-endian.
function parseStatExp(bytes) {
	return {
		hp: (bytes[0] << 8) + bytes[1],
		attack: (bytes[2] << 8) + bytes[3],
		defense: (bytes[4] << 8) + bytes[5],
		speed: (bytes[6] << 8) + bytes[7],
		special: (bytes[8] << 8) + bytes[9],
	};
}

// returns {attack, defense, speed, special}, range 0-15.
function parseDVs(byte1, byte2) {
	return {
		attack: byte1 >> 4,
		defense: byte1 & 0xf,
		speed: byte2 >> 4,
		special: byte2 & 0xf,
	};
}

// load info about a pokémon from a Uint8Array slice, which should start at the
// beginning of the pokémon's data structure in party or PC.
function readPokemon(bytes, gen) {
	if (gen == 1) {
		return {
			species: gen1dex[bytes[0]],
			// level is stored differently in party vs in box
			level: bytes.length > 0x21 ? bytes[0x21] : bytes[3],
			moves: [
				moves[bytes[8]],
				moves[bytes[9]],
				moves[bytes[10]],
				moves[bytes[11]],
			],
			statExp: parseStatExp(bytes.slice(0x11, 0x1b)),
			dvs: parseDVs(bytes[0x1b], bytes[0x1c]),
		};
	} else if (gen == 2) {
		return {
			species: gen2dex[bytes[0]],
			item: items[bytes[1]],
			moves: [
				moves[bytes[2]],
				moves[bytes[3]],
				moves[bytes[4]],
				moves[bytes[5]],
			],
			statExp: parseStatExp(bytes.slice(0x0b, 0x15)),
			dvs: parseDVs(bytes[0x15], bytes[0x16]),
			level: bytes[0x1f],
		};
	} else {
		throw new Error(`no such gen: ${gen}`);
	}
}

// scales a 0-65535 stat experience value to a gen 3+ EV. in gen 3+, EVs after
// 252 don't count for anything, so that's treated as the maximum per stat.
function scaleStatExp(exp) {
	const ev = Math.floor(Math.sqrt(exp));
	return ev > 252 ? 252 : ev;
}

// returns a pokémon's stat experience formatted as gen 3+ EVs.
function formatStatExp(stats) {
	const hp = scaleStatExp(stats.hp),
		attack = scaleStatExp(stats.attack),
		defense = scaleStatExp(stats.defense),
		speed = scaleStatExp(stats.speed),
		special = scaleStatExp(stats.special);
	return `EVs: ${hp} HP / ${attack} Atk / ${defense} Def / ` +
		`${special} SpA / ${special} SpD / ${speed} Spe`;
}

// scales a 0-15 gen 1-2 DV to a 0-31 gen 3+ IV. 0-14 = 0-28, 15 = 31.
// this is what showdown teambuilder does.
function scaleDV(dv) {
	return dv == 15 ? 31 : dv*2;
}

// returns a pokémon's DVs formatted as gen 3+ IVs.
function formatDVs(dvs) {
	const hp = scaleDV( // determined by LSBs of the other four
		8 * (dvs.attack & 1) +
		4 * (dvs.defense & 1) +
		2 * (dvs.speed & 1) +
		(dvs.special & 1));
	const attack = scaleDV(dvs.attack),
		defense = scaleDV(dvs.defense),
		speed = scaleDV(dvs.speed),
		special = scaleDV(dvs.special);
	return `IVs: ${hp} HP / ${attack} Atk / ${defense} Def / ` +
		`${special} SpA / ${special} SpD / ${speed} Spe`;
}

// formats a loaded pokémon as a string in smogon/showdown format.
function formatPokemon(mon) {
	const lines = [];

	if (mon.item) {
		lines.push(`${mon.species} @ ${mon.item}`);
	} else {
		lines.push(mon.species);
	}

	lines.push(`Level: ${mon.level}`);
	lines.push(formatStatExp(mon.statExp));
	lines.push(formatDVs(mon.dvs));

	for (let move of mon.moves.filter(move => move)) {
		lines.push(`- ${move}`);
	}

	return lines.join('\n');
}

// takes an ArrayBuffer and returns a {party, pc, error} object.
function sav2txt(buffer, gen) {
	if (buffer.byteLength != 32*1024) {
		return {error: new Error('Save file is the wrong size!')};
	}

	const bytes = new Uint8Array(buffer);
	const format = (gen == 1) ? gen1Save : gen2Save;

	const party = [];
	const partyLen = bytes[format.partyOffset];
	for (let i = 0; i < partyLen; i++) {
		const offset = format.partyOffset +
			format.partyHeaderSize + i*format.partyPkmnSize;
		const slice = bytes.slice(offset, offset + format.partyPkmnSize);
		const mon = readPokemon(slice, gen);
		if (mon.species) {
			party.push(mon);
		}
	}

	if (!party.length) {
		return {error: new Error('Invalid save file.')};
	}

	const pc = [];

	// first, gen 1 does something weird where it stores the contents of the
	// current box here instead of where it would normally be.
	if (gen == 1) {
		let offset = format.activeBoxOffset;
		for (let j = 0; j < 20; j++) {
			const slice = bytes.slice(offset, offset + format.boxPkmnSize);
			const mon = readPokemon(slice, gen);
			if (mon.species) {
				pc.push(mon);
			}
			offset += format.boxPkmnSize;
		}
	}

	// then the regular boxes are split between two banks.
	for (let pcOffset of format.pcOffsets) {
		for (let i = 0; i < format.numBoxes / format.pcOffsets.length; i++) {
			// box header
			let offset = pcOffset + i*format.boxSize;
			const boxLen = bytes[offset];
			offset += format.boxHeaderSize;

			// box contents
			for (let j = 0; j < boxLen; j++) {
				const slice = bytes.slice(offset, offset + format.boxPkmnSize);
				const mon = readPokemon(slice, gen);
				if (mon.species) {
					pc.push(mon);
				}
				offset += format.boxPkmnSize;
			}
		}
	}

	return {
		party: party.map(mon => formatPokemon(mon)).join('\n\n'),
		pc: pc.map(mon => formatPokemon(mon)).join('\n\n'),
		error: null,
	};
}
