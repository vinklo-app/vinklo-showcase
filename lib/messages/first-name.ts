/**
 * Nombre para el saludo de WhatsApp («¡Hola, {nombre}!»). Puro, sin I/O.
 *
 * La ficha solo tiene `name` (texto libre: «Inés Carvajal de la Torre y
 * Montenegro», «Ana García y Pablo Ruiz», «Familia Ortega»…), así que el
 * nombre de pila se deduce. Regla de oro: NUNCA saludar con un apellido.
 * Ante la duda, solo el primer nombre («Ana García López y Pablo» → «Ana»).
 *
 *  - Persona: el nombre de pila, compuesto si es uno de los habituales
 *    («José Luis Martín» → «José Luis», «María de los Ángeles Pérez» →
 *    «María de los Ángeles»); si no, la primera palabra.
 *  - Pareja o familia con « y », « e » o « & »: «Ana y Pablo». Solo se trata
 *    como pareja si el lado derecho empieza por un nombre de pila: un nombre
 *    conocido, un tratamiento («Tío Paco») o, con lados equilibrados, otro
 *    nombre completo. Así «Inés Carvajal de la Torre y Montenegro», «José
 *    Ortega y Gasset» y «Santiago Ramón y Cajal» saludan solo a la persona.
 *  - Tratamientos: «Tía Carmen», «Abuela Carmen», «Familia Ortega».
 */

/** Prefijos con los que la primera palabra sola suena mal en «¡Hola, …!» («Tía», «Familia»). */
const NAME_PREFIXES = new Set([
  "tía", "tia", "tío", "tio", "tíos", "tios", "tita", "tito", "titos", "abuela", "abuelo", "abuelos",
  "prima", "primo", "primos", "familia", "fam.", "los", "las", "señora", "señor", "sra.", "sr.", "doña", "don",
]);

/** Tratamientos colectivos: «Familia Ortega y Gasset» es una familia, no una pareja. */
const COLLECTIVE_PREFIXES = new Set(["familia", "fam.", "los", "las"]);

const PARTICLES = new Set(["de", "del", "la", "las", "los"]);

/** Sin tildes ni mayúsculas, para comparar con las listas. */
function fold(word: string): string {
  return word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").replace(/\.$/, "");
}

/** «Mª», «M.ª», «Ma.», «Mari» cuentan como «María» para los compuestos. */
function canonical(word: string): string {
  const folded = fold(word);
  if (folded === "mª" || folded === "m.ª" || folded === "ma" || folded === "m.a" || folded === "mari") return "maria";
  return folded;
}

/**
 * Nombres compuestos habituales en España (segunda palabra del nombre de
 * pila). La clave es la primera palabra normalizada. Lista cerrada a
 * propósito: «José Martín García» sigue siendo «José» (Martín es apellido).
 */
const COMPOUND_SECOND: Record<string, ReadonlySet<string>> = {
  jose: new Set(["luis", "maria", "antonio", "manuel", "ramon", "carlos", "javier", "ignacio", "miguel", "angel", "alberto", "enrique", "francisco", "vicente", "andres", "pablo", "joaquin", "mari", "juan", "agustin", "fernando", "rafael", "emilio", "jesus", "daniel", "david", "pedro", "tomas", "ricardo", "gabriel", "lorenzo", "felix", "marcos", "mario", "julian"]),
  juan: new Set(["carlos", "jose", "antonio", "manuel", "luis", "pablo", "francisco", "ramon", "ignacio", "miguel", "pedro", "andres", "diego", "jesus", "alberto", "angel", "bautista", "cruz", "felipe", "gabriel", "jorge", "martin", "vicente", "mari"]),
  maria: new Set(["jose", "jesus", "teresa", "luisa", "isabel", "elena", "pilar", "carmen", "dolores", "victoria", "angeles", "eugenia", "cristina", "rosa", "antonia", "mercedes", "belen", "paz", "sol", "luz", "inmaculada", "nieves", "jose", "fernanda", "cruz", "rocio", "del", "lourdes", "esther", "ines", "concepcion", "asuncion", "soledad", "amparo", "victoria", "montserrat", "reyes", "candelaria", "jesus", "auxiliadora", "begona", "gloria", "olga", "laura", "eva", "ana", "beatriz", "blanca", "aurora", "milagros", "nuria", "sonia", "lucia", "julia", "virginia", "magdalena", "manuela", "josefa", "francisca", "trinidad", "estela", "almudena", "macarena", "consuelo", "rosario", "remedios", "salud", "camino", "carmen"]),
  ana: new Set(["maria", "belen", "isabel", "rosa", "cristina", "luisa", "lucia", "sofia", "teresa", "victoria", "eva"]),
  rosa: new Set(["maria", "ana"]),
  miguel: new Set(["angel"]),
  luis: new Set(["miguel", "alberto", "angel", "enrique", "fernando", "javier", "carlos", "felipe", "mariano"]),
  francisco: new Set(["javier", "jose", "manuel", "jesus", "miguel"]),
  pedro: new Set(["jose", "luis", "pablo", "antonio", "juan"]),
  jesus: new Set(["maria", "angel"]),
  juana: new Set(["maria"]),
  carlos: new Set(["alberto"]),
  antonio: new Set(["jose", "luis"]),
  manuel: new Set(["jesus"]),
  mariano: new Set(["jose"]),
};

/**
 * «María del Carmen», «María de los Ángeles», «Juan de Dios»: lo que puede ir
 * tras la partícula. Lista cerrada: «María de la Torre» es María + apellido.
 */
const PARTICLE_TAILS = new Set([
  "carmen", "mar", "pilar", "rocio", "angeles", "mercedes", "dolores", "remedios", "reyes", "luz", "paz", "sol",
  "consuelo", "rosario", "socorro", "gracia", "valle", "cielo", "olvido", "camino", "prado", "pino", "puerto",
  "asuncion", "concepcion", "nieves", "montserrat", "fatima", "belen", "henar", "o", "amparo", "lourdes", "milagros",
  "carmen", "rosa", "salud", "esperanza", "candelaria", "loreto", "alba", "aguas", "angustias", "monte", "sagrario",
  "soledad", "victoria", "pena", "encarnacion", "gloria", "dios", "jesus", "lluc", "mont",
]);

/** Quien puede llevar «de la/del …» en el nombre de pila. */
const PARTICLE_HEADS = new Set(["maria", "juan", "jose"]);

/**
 * Nombres de pila frecuentes (INE): sirven para reconocer el lado derecho de
 * una pareja («… y Pablo Ruiz»). No hace falta que esté todo el mundo: quien
 * no aparece se trata con la regla de lados equilibrados o, ante la duda,
 * se saluda solo a la primera persona.
 */
const KNOWN_FIRST_NAMES = new Set([
  // Mujeres
  "maria", "carmen", "ana", "isabel", "laura", "cristina", "marta", "lucia", "pilar", "elena", "rosa", "paula", "sara",
  "raquel", "beatriz", "patricia", "silvia", "monica", "andrea", "irene", "alba", "nuria", "julia", "sofia", "teresa",
  "rocio", "eva", "angela", "marina", "claudia", "carla", "alicia", "sonia", "lorena", "noelia", "ines", "natalia",
  "susana", "yolanda", "victoria", "mercedes", "dolores", "lola", "inmaculada", "montserrat", "rosario", "nerea",
  "aitana", "valeria", "daniela", "martina", "emma", "olivia", "noa", "carlota", "blanca", "ines", "esther", "miriam",
  "begona", "ainhoa", "leire", "uxue", "nahia", "irati", "amaia", "maite", "olga", "veronica", "vanesa", "gloria",
  "lourdes", "concepcion", "josefa", "francisca", "antonia", "manuela", "remedios", "amparo", "consuelo", "almudena",
  "macarena", "candela", "celia", "clara", "diana", "elisa", "fatima", "gema", "helena", "jimena", "lidia", "luisa",
  "mar", "margarita", "mireia", "montse", "nieves", "rebeca", "rut", "ruth", "sandra", "tamara", "vega", "zoe",
  "aurora", "belen", "estela", "marisa", "maribel", "mariluz", "maricarmen", "chelo", "pepa", "conchi", "encarna",
  // Hombres
  "jose", "antonio", "manuel", "francisco", "david", "juan", "javier", "daniel", "carlos", "jesus", "alejandro",
  "miguel", "rafael", "pedro", "pablo", "angel", "sergio", "fernando", "jorge", "luis", "alberto", "alvaro", "adrian",
  "diego", "raul", "ivan", "ruben", "enrique", "oscar", "ramon", "andres", "vicente", "joaquin", "santiago", "victor",
  "mario", "roberto", "jaime", "ignacio", "eduardo", "marcos", "alfonso", "hugo", "martin", "lucas", "mateo", "leo",
  "nicolas", "gonzalo", "guillermo", "ricardo", "emilio", "tomas", "agustin", "felipe", "julian", "gabriel", "salvador",
  "cristian", "samuel", "hector", "marc", "jordi", "xavier", "iker", "unai", "asier", "aitor", "mikel", "jon",
  "inigo", "xabier", "borja", "inaki", "nacho", "pepe", "paco", "manolo", "lolo", "kike", "dani", "alex", "rodrigo",
  "bruno", "izan", "gael", "dario", "marcelo", "arturo", "benito", "cesar", "esteban", "fabian", "gregorio", "gustavo",
  "lorenzo", "marcial", "nestor", "octavio", "pascual", "quique", "sebastian", "valentin",
]);

/** Apellidos frecuentes que no acaban en «-ez» (los patronímicos se reconocen solos). */
const COMMON_SURNAMES = new Set([
  "garcia", "ruiz", "diaz", "moreno", "munoz", "alonso", "romero", "navarro", "torres", "dominguez", "gil", "serrano",
  "blanco", "molina", "morales", "ortega", "delgado", "castro", "ortiz", "rubio", "marin", "sanz", "iglesias", "nunez",
  "medina", "garrido", "cortes", "castillo", "santos", "guerrero", "lozano", "cano", "prieto", "mendez", "cruz",
  "calvo", "gallego", "vidal", "leon", "herrera", "pena", "flores", "cabrera", "campos", "vega", "fuentes", "carrasco",
  "diez", "reyes", "caballero", "nieto", "aguilar", "pascual", "santana", "herrero", "montero", "lorenzo", "hidalgo",
  "gimenez", "ibanez", "ferrer", "duran", "santiago", "benitez", "mora", "vicente", "vargas", "arias", "carmona",
  "crespo", "roman", "pastor", "soto", "saez", "velasco", "moya", "soler", "parra", "esteban", "bravo", "gallardo",
  "rojas", "gasset", "cajal", "montenegro", "carvajal", "guzman", "pardo", "mesa", "rivas", "marquez", "salazar",
]);

/** Une partículas a la palabra siguiente: «de», «la», «Torre» → una unidad. */
function units(words: readonly string[]): string[][] {
  const out: string[][] = [];
  let pending: string[] = [];
  for (const word of words) {
    if (PARTICLES.has(fold(word))) { pending.push(word); continue; }
    out.push([...pending, word]);
    pending = [];
  }
  if (pending.length) out.push(pending);
  return out;
}

/** Palabras del nombre de pila al principio de `words` (1 o más). */
function givenNameLength(words: readonly string[]): number {
  if (words.length <= 1) return words.length;
  const head = canonical(words[0]!);
  // «María de los Ángeles», «María del Carmen», «Juan de Dios», «María de la O».
  if (PARTICLE_HEADS.has(head) && PARTICLES.has(fold(words[1]!))) {
    let index = 1;
    while (index < words.length && PARTICLES.has(fold(words[index]!))) index += 1;
    if (index > 1 && index < words.length && PARTICLE_TAILS.has(fold(words[index]!))) return index + 1;
    return 1;
  }
  // «José Luis», «María José», «Mari Carmen», «Juan Carlos».
  if (COMPOUND_SECOND[head]?.has(fold(words[1]!))) return 2;
  return 1;
}

function isPrefix(word: string | undefined): boolean {
  return word !== undefined && NAME_PREFIXES.has(word.toLocaleLowerCase("es"));
}

/** Nombre corto de una persona (o de un tratamiento: «Tía Carmen», «Familia Pérez»). */
function shortName(part: string): string {
  const words = part.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (isPrefix(words[0]) && words[1]) {
    // «Tía María José» → «Tía María José»; «Familia de la Fuente» → «Familia de la Fuente».
    const rest = words.slice(1);
    const tail = COLLECTIVE_PREFIXES.has(words[0]!.toLocaleLowerCase("es")) ? (units(rest)[0] ?? rest.slice(0, 1)) : rest.slice(0, givenNameLength(rest));
    return [words[0]!, ...tail].join(" ");
  }
  return words.slice(0, givenNameLength(words)).join(" ");
}

/** Cuántas unidades tiene el nombre (nombre compuesto = 1; «de la Torre» = 1). */
function unitCount(part: string): number {
  const words = part.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  if (isPrefix(words[0]) && words[1]) return 1 + Math.max(0, units(words.slice(1)).length - 1);
  const given = givenNameLength(words);
  return 1 + units(words.slice(given)).length;
}

/**
 * ¿Son solo apellidos? («Pérez», «García López», «de la Fuente Pérez»):
 * ningún nombre de pila ni tratamiento, y cada palabra es un apellido
 * reconocible (patronímico en -ez o frecuente) o va tras una partícula.
 */
function looksLikeSurnames(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let surnames = 0;
  let afterParticle = false;
  for (const word of words) {
    const folded = fold(word);
    if (PARTICLES.has(folded)) { afterParticle = true; continue; }
    if (KNOWN_FIRST_NAMES.has(canonical(word)) || KNOWN_FIRST_NAMES.has(folded) || isPrefix(word)) return false;
    if (!afterParticle && !/[^aeiou]ez$/.test(folded) && !COMMON_SURNAMES.has(folded)) return false;
    afterParticle = false;
    surnames += 1;
  }
  return surnames > 0;
}

/** ¿El lado derecho de « y » empieza por un nombre de pila (y no por un apellido)? */
function startsWithGivenName(right: string, left: string): boolean {
  const words = right.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return false;
  if (isPrefix(first)) return true;
  if (PARTICLES.has(fold(first))) return false;
  if (KNOWN_FIRST_NAMES.has(canonical(first)) || KNOWN_FIRST_NAMES.has(fold(first))) return true;
  // Patronímico («González», «Fernández», «López»): es un apellido, no un nombre.
  if (/[^aeiou]ez$/.test(fold(first)) || COMMON_SURNAMES.has(fold(first))) return false;
  // Nombre que no está en la lista: solo si los lados se parecen («Ana y Uxue», «Ana García y Kevin Smith»).
  const leftUnits = unitCount(left);
  const rightUnits = unitCount(right);
  if (rightUnits === 1) return leftUnits === 1;
  return leftUnits <= rightUnits;
}

/** «y» salvo ante el sonido /i/: «Pablo e Inés», «Ana e Ignacio» (pero «Ana y Hierro», «Ana y Yolanda»). */
function conjunctionBefore(word: string): "y" | "e" {
  return /^h?i(?!e)/.test(fold(word)) ? "e" : "y";
}

/**
 * Nombre para el saludo: «Inés Montenegro García» → «Inés», «José Luis
 * Martín» → «José Luis», «Ana García y Pablo Ruiz» → «Ana y Pablo», «Tía
 * Carmen» → «Tía Carmen», «Familia Pérez Soler» → «Familia Pérez». Nunca un
 * apellido solo: «Inés Carvajal de la Torre y Montenegro» → «Inés».
 */
export function firstName(name: string | null | undefined): string {
  const full = (name ?? "").replace(/\s+/g, " ").trim();
  if (!full) return "";
  const firstWord = full.split(" ")[0]!;
  // «Familia Ortega y Gasset», «Los García y López»: un único grupo.
  const collective = COLLECTIVE_PREFIXES.has(firstWord.toLocaleLowerCase("es"));

  // «García López, Ana» (formato de muchas hojas de cálculo): el nombre va tras la coma.
  const conjunction = /\s(?:y|e|&)\s/i.test(full);
  const commaParts = full.split(/\s*,\s*/).filter(Boolean);
  if (!collective && !conjunction && commaParts.length === 2 && !KNOWN_FIRST_NAMES.has(canonical(firstWord.replace(/,$/, "")))) {
    return shortName(commaParts[1]!);
  }

  // «Pérez, Ana y Pablo» / «García López, Ana y Pablo»: apellidos delante de
  // la coma y varias personas detrás (revisión del bloque 1, F6). Solo si
  // TODO lo de antes de la coma tiene forma de apellido (patronímico en -ez,
  // apellido frecuente o partícula) y ninguna palabra es un nombre de pila;
  // así «Ana, Pablo y Lucía» sigue siendo una lista.
  if (!collective && conjunction && commaParts.length >= 2 && looksLikeSurnames(commaParts[0]!)) {
    return firstName(commaParts.slice(1).join(", "));
  }

  // Varias personas: «Ana, Pablo y Lucía» / «Ana y Pablo» / «Ana & Pablo».
  const people = full.split(/\s*,\s*|\s+(?:y|e|&)\s+/i).filter(Boolean);
  if (people.length >= 2 && (!collective || isPrefix(people[1]!.split(" ")[0]))) {
    const accepted = [people[0]!];
    for (const person of people.slice(1)) {
      if (!startsWithGivenName(person, accepted[accepted.length - 1]!)) break;
      accepted.push(person);
    }
    // «Ana Ruiz y Pablo Ortega y Gasset»: se quedan las personas reconocidas.
    if (accepted.length >= 2) {
      const names = accepted.map(shortName);
      const last = names[names.length - 1]!;
      return `${names.slice(0, -1).join(", ")} ${conjunctionBefore(last)} ${last}`;
    }
  }
  return shortName(collective ? full.split(/\s+(?:y|e|&)\s+/i)[0]! : people[0] ?? full);
}
