import { getDb } from "../database.js";
import type { CityZone, HackathonMode, HackathonRecord } from "../../types/index.js";

interface HackathonRow {
  id: string;
  title: string;
  organizer: string;
  location: string;
  city_zone: string;
  venue: string;
  mode: string;
  start_date: string;
  end_date: string;
  registration_deadline: string;
  prize_pool: string | null;
  url: string;
  tags_json: string;
  is_bookmarked: number;
  discovered_at: string;
}

function mapRowToHackathon(row: HackathonRow): HackathonRecord {
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(row.tags_json);
  } catch {
    parsedTags = [];
  }

  return {
    id: row.id,
    title: row.title,
    organizer: row.organizer,
    location: row.location,
    cityZone: row.city_zone as CityZone,
    venue: row.venue,
    mode: row.mode as HackathonMode,
    startDate: row.start_date,
    endDate: row.end_date,
    registrationDeadline: row.registration_deadline,
    prizePool: row.prize_pool ?? undefined,
    url: row.url,
    tags: parsedTags,
    isBookmarked: Boolean(row.is_bookmarked),
    discoveredAt: row.discovered_at,
  };
}

/**
 * Inserts a hackathon record into the database.
 * @param record Hackathon record details.
 * @returns Fully populated HackathonRecord.
 */
export function insertHackathon(record: HackathonRecord): HackathonRecord {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO hackathons (
      id, title, organizer, location, city_zone, venue, mode,
      start_date, end_date, registration_deadline, prize_pool,
      url, tags_json, is_bookmarked, discovered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      registration_deadline = excluded.registration_deadline,
      url = excluded.url,
      prize_pool = excluded.prize_pool
  `);

  stmt.run(
    record.id,
    record.title,
    record.organizer,
    record.location,
    record.cityZone,
    record.venue,
    record.mode,
    record.startDate,
    record.endDate,
    record.registrationDeadline,
    record.prizePool ?? null,
    record.url,
    JSON.stringify(record.tags),
    record.isBookmarked ? 1 : 0,
    record.discoveredAt
  );

  return record;
}

/**
 * Retrieves hackathons matching specified city zones.
 * @param cityZones Array of targeted zones (e.g. ['mumbai', 'thane', 'navimumbai', 'pune']).
 * @param onlyUpcoming If true, filters for registration deadlines on or after today.
 * @returns Array of matching Hackathon records ordered by deadline.
 */
export function findHackathonsByCity(cityZones: CityZone[], onlyUpcoming = true): HackathonRecord[] {
  const db = getDb();
  const placeholders = cityZones.map(() => "?").join(", ");
  const today = new Date().toISOString().slice(0, 10);

  const query = onlyUpcoming
    ? `SELECT * FROM hackathons WHERE city_zone IN (${placeholders}) AND registration_deadline >= ? ORDER BY registration_deadline ASC`
    : `SELECT * FROM hackathons WHERE city_zone IN (${placeholders}) ORDER BY registration_deadline ASC`;

  const stmt = db.prepare(query);
  const params = onlyUpcoming ? [...cityZones, today] : cityZones;
  const rows = (stmt.all(...params) as unknown) as HackathonRow[];
  return rows.map(mapRowToHackathon);
}

/**
 * Retrieves all hackathons bookmarked by the user.
 * @returns Array of bookmarked hackathons.
 */
export function findBookmarkedHackathons(): HackathonRecord[] {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM hackathons WHERE is_bookmarked = 1 ORDER BY registration_deadline ASC");
  const rows = (stmt.all() as unknown) as HackathonRow[];
  return rows.map(mapRowToHackathon);
}

/**
 * Toggles the bookmark status of a hackathon.
 * @param id Hackathon ID.
 * @returns New bookmark boolean state.
 */
export function toggleBookmark(id: string): boolean {
  const db = getDb();
  const current = findHackathonById(id);
  if (!current) return false;

  const newStatus = current.isBookmarked ? 0 : 1;
  const stmt = db.prepare("UPDATE hackathons SET is_bookmarked = ? WHERE id = ?");
  stmt.run(newStatus, id);
  return Boolean(newStatus);
}

/**
 * Retrieves a single hackathon by ID.
 * @param id Hackathon identifier.
 * @returns Hackathon record or null.
 */
export function findHackathonById(id: string): HackathonRecord | null {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM hackathons WHERE id = ?");
  const row = (stmt.get(id) as unknown) as HackathonRow | undefined;
  return row ? mapRowToHackathon(row) : null;
}

/**
 * Seeds initial curated regional hackathons across Mumbai, Thane, Navi Mumbai, and Pune.
 */
export function seedInitialCuratedHackathons(): void {
  const db = getDb();
  const checkStmt = db.prepare("SELECT COUNT(*) as count FROM hackathons");
  const countRow = (checkStmt.get() as unknown) as { count: number };
  if (countRow.count > 0) {
    return; // Already populated
  }

  const initialList: HackathonRecord[] = [
    {
      id: "hack-spit-2026",
      title: "HackSPIT 2026",
      organizer: "Sardar Patel Institute of Technology (SPIT)",
      location: "Mumbai (Andheri West)",
      cityZone: "mumbai",
      venue: "SPIT Campus, Bhavans College Compound, Munshi Nagar, Andheri West",
      mode: "offline",
      startDate: "2026-10-24",
      endDate: "2026-10-25",
      registrationDeadline: "2026-10-18",
      prizePool: "₹1,50,000",
      url: "https://devfolio.co/hackspit2026",
      tags: ["AI", "Web3", "EdTech", "Open Innovation"],
      isBookmarked: false,
      discoveredAt: new Date().toISOString(),
    },
    {
      id: "hack-vjti-codesys",
      title: "VJTI CoDeSys National Hackathon",
      organizer: "VJTI Mumbai (Matunga)",
      location: "Mumbai (Matunga)",
      cityZone: "mumbai",
      venue: "Veermata Jijabai Technological Institute, H R Mahajani Marg, Matunga",
      mode: "offline",
      startDate: "2026-11-07",
      endDate: "2026-11-08",
      registrationDeadline: "2026-10-31",
      prizePool: "₹2,00,000",
      url: "https://unstop.com/hackathons/vjti-codesys-2026",
      tags: ["Systems", "AI", "Cloud Architecture"],
      isBookmarked: false,
      discoveredAt: new Date().toISOString(),
    },
    {
      id: "hack-djsce-unicode",
      title: "DJ Unicode Hackathon",
      organizer: "D.J. Sanghvi College of Engineering",
      location: "Mumbai (Vile Parle West)",
      cityZone: "mumbai",
      venue: "DJSCE Campus, Gulmohar Road, Vile Parle West",
      mode: "offline",
      startDate: "2026-11-14",
      endDate: "2026-11-15",
      registrationDeadline: "2026-11-05",
      prizePool: "₹1,00,000",
      url: "https://devfolio.co/dj-unicode-hack",
      tags: ["FullStack", "Mobile", "AI/ML"],
      isBookmarked: false,
      discoveredAt: new Date().toISOString(),
    },
    {
      id: "hack-mumbai-hacks",
      title: "MumbaiHacks 2026 (GenAI Edition)",
      organizer: "Tech Entrepreneurs Mumbai",
      location: "Mumbai (South Mumbai)",
      cityZone: "mumbai",
      venue: "World Trade Centre, Cuffe Parade, Mumbai",
      mode: "hybrid",
      startDate: "2026-11-21",
      endDate: "2026-11-22",
      registrationDeadline: "2026-11-10",
      prizePool: "₹5,00,000",
      url: "https://mumbaihacks.com",
      tags: ["GenAI", "LLMs", "Startups"],
      isBookmarked: false,
      discoveredAt: new Date().toISOString(),
    },
    {
      id: "hack-pillai-alegria",
      title: "HackPillai (Alegria Techfest)",
      organizer: "Pillai College of Engineering (Panvel)",
      location: "Navi Mumbai (Panvel)",
      cityZone: "navimumbai",
      venue: "Dr. K. M. Vasudevan Pillai Campus, Sector 16, New Panvel",
      mode: "offline",
      startDate: "2026-11-28",
      endDate: "2026-11-29",
      registrationDeadline: "2026-11-18",
      prizePool: "₹1,20,000",
      url: "https://unstop.com/hackathons/hackpillai-2026",
      tags: ["AI", "IoT", "Cybersecurity"],
      isBookmarked: false,
      discoveredAt: new Date().toISOString(),
    },
    {
      id: "hack-sies-cognition",
      title: "Cognition Hackathon 2026",
      organizer: "SIES Graduate School of Technology",
      location: "Navi Mumbai (Nerul)",
      cityZone: "navimumbai",
      venue: "SIES GST Campus, Sector 5, Nerul, Navi Mumbai",
      mode: "offline",
      startDate: "2026-12-05",
      endDate: "2026-12-06",
      registrationDeadline: "2026-11-25",
      prizePool: "₹75,000",
      url: "https://devfolio.co/cognition-sies",
      tags: ["FinTech", "Blockchain", "Healthcare AI"],
      isBookmarked: false,
      discoveredAt: new Date().toISOString(),
    },
    {
      id: "hack-kc-thane",
      title: "Thane TechSprint Hackathon",
      organizer: "K.C. College of Engineering (Thane)",
      location: "Thane (East)",
      cityZone: "thane",
      venue: "Mith Bunder Road, Kopri, Thane East",
      mode: "offline",
      startDate: "2026-12-12",
      endDate: "2026-12-13",
      registrationDeadline: "2026-12-01",
      prizePool: "₹80,000",
      url: "https://unstop.com/hackathons/thane-techsprint",
      tags: ["Smart Cities", "Automation", "Web3"],
      isBookmarked: false,
      discoveredAt: new Date().toISOString(),
    },
    {
      id: "hack-coep-mindspark",
      title: "MindSpark Hackathon 2026",
      organizer: "COEP Technological University",
      location: "Pune (Shivajinagar)",
      cityZone: "pune",
      venue: "COEP Campus, Wellesely Road, Shivajinagar, Pune",
      mode: "offline",
      startDate: "2026-12-19",
      endDate: "2026-12-20",
      registrationDeadline: "2026-12-08",
      prizePool: "₹2,50,000",
      url: "https://mind-spark.org/hackathon",
      tags: ["DeepTech", "Hardware/Embedded", "AI"],
      isBookmarked: false,
      discoveredAt: new Date().toISOString(),
    },
    {
      id: "hack-pict-credenz",
      title: "Credenz InC Hackathon",
      organizer: "Pune Institute of Computer Technology (PICT)",
      location: "Pune (Dhankawadi)",
      cityZone: "pune",
      venue: "PICT Campus, Survey No. 27, Dhankawadi, Pune",
      mode: "offline",
      startDate: "2027-01-09",
      endDate: "2027-01-10",
      registrationDeadline: "2026-12-28",
      prizePool: "₹1,50,000",
      url: "https://credenz.co.in/hackathon",
      tags: ["Algorithms", "High Performance Computing", "AI"],
      isBookmarked: false,
      discoveredAt: new Date().toISOString(),
    },
    {
      id: "hack-sih-2026",
      title: "Smart India Hackathon (SIH 2026 Internal Qualifier)",
      organizer: "AICTE & Ministry of Education",
      location: "Mumbai & All India",
      cityZone: "mumbai",
      venue: "College Internal Round & Nodal Center",
      mode: "hybrid",
      startDate: "2026-10-30",
      endDate: "2026-10-31",
      registrationDeadline: "2026-10-20",
      prizePool: "₹1,00,000 per problem statement",
      url: "https://sih.gov.in",
      tags: ["National", "Public Problem Statements", "Hardware & Software"],
      isBookmarked: false,
      discoveredAt: new Date().toISOString(),
    },
  ];

  for (const item of initialList) {
    insertHackathon(item);
  }
}
