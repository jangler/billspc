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

// load info about a pokémon from a Uint8Array slice, which should start at the
// beginning of the pokémon's data structure in party or PC.
function readPokemon(bytes, gen) {
	if (gen == 1) {
		return {
			species: gen1dex[bytes[0]],
			moves: [
				moves[bytes[8]],
				moves[bytes[9]],
				moves[bytes[10]],
				moves[bytes[11]],
			],
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
		};
	} else {
		throw new Error(`no such gen: ${gen}`);
	}
}

// formats a loaded pokémon as a string in smogon/showdown format.
function formatPokemon(mon) {
	const lines = [];

	if (mon.item) {
		lines.push(`${mon.species} @ ${mon.item}`);
	} else {
		lines.push(mon.species);
	}

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
		return {error: new Error('Invalid save file.')}
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
