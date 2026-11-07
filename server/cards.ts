// Sample cards. Each category is a pool; every round the server draws one entry from each pool
// to make the five options. Add more entries whenever you like - no other code needs to change.
// `prompt` is what everyone sees. `answer` is the real answer and stays on the server until the reveal.
import type { Category } from '../shared/types.js';

export interface CardEntry {
  prompt: string;
  answer: string;
}

export const CARDS: Record<Category, CardEntry[]> = {
  word: [
    { prompt: 'Sesquipedalian', answer: 'Given to using long words; also describes a very long word itself.' },
    { prompt: 'Borborygmus', answer: 'A rumbling or gurgling noise made by gas moving through the intestines.' },
    { prompt: 'Ultracrepidarian', answer: 'Someone who gives opinions and advice on matters outside their knowledge.' },
    { prompt: 'Quockerwodger', answer: 'A wooden puppet operated by strings; also a politician who acts on another\'s orders.' },
    { prompt: 'Callipygian', answer: 'Having beautifully shaped buttocks.' },
    { prompt: 'Floccinaucinihilipilification', answer: 'The act of estimating something as worthless.' },
    { prompt: 'Gongoozler', answer: 'A person who enjoys watching boats and activity on canals.' },
    { prompt: 'Snollygoster', answer: 'A shrewd, unprincipled person, especially a politician.' },
    { prompt: 'Phosphene', answer: 'A ring or spot of light you see when you press on your closed eyes.' },
    { prompt: 'Tittle', answer: 'A tiny dot or stroke in writing, such as the dot over a lowercase i.' },
  ],
  date: [
    { prompt: 'November 3, 1957', answer: 'The Soviet Union launched Laika, the first animal to orbit Earth, aboard Sputnik 2.' },
    { prompt: 'October 29, 1969', answer: 'The first message was sent over ARPANET; the system crashed after only "lo" of "login".' },
    { prompt: 'July 5, 1996', answer: 'Dolly the sheep, the first mammal cloned from an adult cell, was born.' },
    { prompt: 'May 11, 1997', answer: 'IBM\'s Deep Blue beat world chess champion Garry Kasparov in a six-game rematch.' },
    { prompt: 'September 9, 1947', answer: 'Operators found a moth stuck in a relay of the Harvard Mark II computer, the "first bug".' },
    { prompt: 'August 27, 1883', answer: 'The volcano Krakatoa erupted, in a blast heard thousands of miles away.' },
    { prompt: 'January 15, 1967', answer: 'The first Super Bowl was played.' },
    { prompt: 'March 15, 1985', answer: 'The first .com domain name, symbolics.com, was registered.' },
    { prompt: 'September 2, 1666', answer: 'The Great Fire of London started in a baker\'s shop on Pudding Lane.' },
    { prompt: 'June 29, 2007', answer: 'The first iPhone went on sale.' },
  ],
  movie: [
    { prompt: 'Primer (2004)', answer: 'Two engineers working out of a garage accidentally invent a time-travel machine.' },
    { prompt: 'Duel (1971)', answer: 'A traveling salesman is pursued along a desert highway by the unseen driver of a menacing tanker truck.' },
    { prompt: 'Rope (1948)', answer: 'Two men strangle a classmate, hide the body in a chest, then host a dinner party around it.' },
    { prompt: 'Swiss Army Man (2016)', answer: 'A man stranded on a deserted island befriends a flatulent corpse that washes ashore.' },
    { prompt: 'Cube (1997)', answer: 'Strangers wake up inside a vast maze of cube-shaped rooms, many of them booby-trapped.' },
    { prompt: 'Brazil (1985)', answer: 'In a bureaucratic dystopia, a clerical error caused by a fly gets the wrong man arrested.' },
    { prompt: 'Koyaanisqatsi (1982)', answer: 'A wordless documentary contrasting nature with modern life, set to a Philip Glass score.' },
    { prompt: 'Buried (2010)', answer: 'An American contractor wakes up trapped in a coffin in Iraq with only a cell phone and a lighter.' },
    { prompt: 'Tremors (1990)', answer: 'Two handymen and their neighbors in a tiny Nevada town fight giant worm-like creatures from underground.' },
    { prompt: 'The Lobster (2015)', answer: 'In a near future, single people must find a partner within 45 days or be turned into an animal of their choice.' },
  ],
  acronym: [
    { prompt: 'TASER', answer: 'Thomas A. Swift\'s Electric Rifle' },
    { prompt: 'CAPTCHA', answer: 'Completely Automated Public Turing test to tell Computers and Humans Apart' },
    { prompt: 'NASDAQ', answer: 'National Association of Securities Dealers Automated Quotations' },
    { prompt: 'SONAR', answer: 'Sound Navigation And Ranging' },
    { prompt: 'ZIP (code)', answer: 'Zone Improvement Plan' },
    { prompt: 'BASIC', answer: 'Beginner\'s All-purpose Symbolic Instruction Code' },
    { prompt: 'COBOL', answer: 'Common Business-Oriented Language' },
    { prompt: 'NIMBY', answer: 'Not In My Back Yard' },
    { prompt: 'UNICEF', answer: 'United Nations International Children\'s Emergency Fund' },
    { prompt: 'SNAFU', answer: 'Situation Normal: All Fouled Up' },
  ],
  person: [
    { prompt: 'Hedy Lamarr', answer: 'A Hollywood actress who also co-invented frequency-hopping technology that was a forerunner of modern Wi-Fi and Bluetooth.' },
    { prompt: 'Zheng Yi Sao', answer: 'A 19th-century Chinese pirate who commanded a fleet of hundreds of ships and tens of thousands of pirates.' },
    { prompt: 'Joshua Norton', answer: 'A San Francisco resident who declared himself "Emperor of the United States" in 1859 and was beloved by the city.' },
    { prompt: 'Nellie Bly', answer: 'A journalist who went undercover in an insane asylum and circled the globe in 72 days.' },
    { prompt: 'Henrietta Lacks', answer: 'A woman whose cancer cells, taken without her consent, became the first immortal human cell line, HeLa.' },
    { prompt: 'Tarrare', answer: 'An 18th-century French showman with an insatiable appetite who ate corks, live animals and stones.' },
    { prompt: 'Mary Anning', answer: 'A fossil collector who uncovered the first ichthyosaur skeleton to be recognized by scientists, on the English coast, as a child.' },
    { prompt: 'Simo Häyhä', answer: 'A Finnish sniper nicknamed "White Death" who had hundreds of confirmed kills in the Winter War.' },
    { prompt: 'Hiroo Onoda', answer: 'A Japanese soldier who kept fighting in the Philippine jungle for 29 years after World War II ended.' },
    { prompt: 'Stanislav Petrov', answer: 'A Soviet officer who correctly judged a 1983 missile-attack alarm to be false and may have prevented nuclear war.' },
  ],
};
