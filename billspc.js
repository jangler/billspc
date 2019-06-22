// save file structure
const partyOffset = 0x1a6d;
const partyPkmnSize = 0x30;
const pcOffset = 0x4000;
const numBoxes = 14;
const boxSize = 0x450;
const boxHeaderSize = 0x16;
const boxPkmnSize = 0x20;

// load info about a pokémon from an ArrayBuffer slice, which should start at
// the beginning of the pokémon's data structure in party or PC.
function readPokemon(buffer) {
	const bytes = new Uint8Array(buffer);
	return {
		species: dex[bytes[0]],
		item: items[bytes[1]],
		moves: [
			moves[bytes[2]],
			moves[bytes[3]],
			moves[bytes[4]],
			moves[bytes[5]],
		],
	};
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
function sav2txt(buffer) {
	if (buffer.byteLength != 32*1024) {
		return {error: new Error('save file is the wrong size!')};
	}

	const party = [];
	for (let i = 0; i < 6; i++) {
		const offset = partyOffset + i*partyPkmnSize;
		const slice = buffer.slice(offset, offset + partyPkmnSize);
		const mon = readPokemon(slice);
		if (mon.species) {
			party.push(mon);
		}
	}

	const pc = [];
	for (let i = 0; i < numBoxes; i++) {
		// box header
		let offset = pcOffset + i*boxSize;
		const boxlen = (new Uint8Array(buffer.slice(offset)))[0];
		offset += boxHeaderSize;

		// box contents
		for (let j = 0; j < boxlen; j++) {
			const slice = buffer.slice(offset, offset + boxPkmnSize);
			const mon = readPokemon(slice);
			if (mon.species) {
				pc.push(mon);
			}
			offset += boxPkmnSize;
		}
	}

	return {
		party: party.map(mon => formatPokemon(mon)).join('\n\n'),
		pc: pc.map(mon => formatPokemon(mon)).join('\n\n'),
		error: null,
	};
}
