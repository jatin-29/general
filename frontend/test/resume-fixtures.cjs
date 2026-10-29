// Sample resumes for the "Fill from my resume" check: two common PDF layouts and a Word file.
const zlib = require("zlib");

const css = `body{font:11pt/1.35 "Times New Roman",serif;margin:36px 44px;color:#111}h1{font-size:22pt;text-align:center;margin:0}
.c{text-align:center}h2{font-size:12pt;text-transform:uppercase;border-bottom:1px solid #000;margin:14px 0 6px}
.r{display:flex;justify-content:space-between}ul{margin:2px 0 6px 18px;padding:0}a{color:#111;text-decoration:none}p{margin:2px 0}`;

// Overleaf "Jake's resume" style: one column, dates on the right, clickable links.
const JAKE = `<html><head><meta charset="utf-8"><style>${css}</style></head><body>
<h1>Jatin Maggo</h1>
<p class="c">+91 98765 43210 | <a href="mailto:jatin.maggo@gmail.com">jatin.maggo@gmail.com</a> | <a href="https://www.linkedin.com/in/jatin-maggo/">linkedin.com/in/jatin-maggo</a> | <a href="https://github.com/jatin-29">github.com/jatin-29</a></p>
<h2>Education</h2>
<div class="r"><b>Delhi Technological University</b><span>New Delhi, India</span></div>
<div class="r"><i>Bachelor of Technology in Computer Science; CGPA: 8.42/10</i><span>Aug 2022 – May 2026</span></div>
<div class="r"><b>Delhi Public School, R.K. Puram</b><span>New Delhi</span></div>
<div class="r"><i>Class XII (CBSE) – 92.4%</i><span>2022</span></div>
<h2>Experience</h2>
<div class="r"><b>Acme Technologies</b><span>May 2025 – Jul 2025</span></div>
<div class="r"><i>Software Engineering Intern</i><span>Bengaluru, India</span></div>
<ul><li>Built a job aggregation pipeline in Python that cut manual screening work by 70% for the hiring
team across three regions</li><li>Wrote REST APIs with FastAPI and PostgreSQL serving 5k daily users</li></ul>
<h2>Projects</h2>
<div class="r"><span><b>OpeningsHub</b> | <i>Next.js, FastAPI, Python</i></span><span>Jun 2025 – Present</span></div>
<ul><li>Aggregates job posts from Telegram groups into a filterable dashboard</li><li>Deployed on GitHub Pages with encrypted data</li></ul>
<div class="r"><span><b>Chess Engine</b> | <i>C++</i></span><span>Jan 2025</span></div>
<ul><li>Alpha-beta search engine rated 1800 on Lichess</li></ul>
<h2>Technical Skills</h2>
<p><b>Languages:</b> Python, Java, C++, JavaScript, SQL</p>
<p><b>Frameworks:</b> React, Next.js, FastAPI, Django</p>
<p><b>Tools:</b> Git, Docker, AWS, Linux</p>
<h2>Achievements</h2>
<ul><li>4 star on CodeChef (max rating 1950)</li><li>Winner, Smart India Hackathon 2024</li></ul>
</body></html>`;

// Typical Indian fresher resume: objective, marks table, numbered projects, declaration.
const FRESHER = `<html><head><meta charset="utf-8"><style>${css}td,th{border:1px solid #444;padding:3px 8px;text-align:left}table{border-collapse:collapse;width:100%}</style></head><body>
<h1 style="text-align:left">RAHUL KUMAR SHARMA</h1>
<p>Email: rahul.sharma@example.com &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Mobile: 9876501234</p>
<p>Address: Sector 15, Rohini, Delhi</p>
<h2>Career Objective</h2>
<p>To work in a challenging environment where I can use my analytical skills and grow with the organisation.</p>
<h2>Educational Qualifications</h2>
<table><tr><th>Qualification</th><th>Institute</th><th>Board/University</th><th>Year</th><th>Score</th></tr>
<tr><td>B.Tech (ECE)</td><td>Netaji Subhas University of Technology</td><td>NSUT</td><td>2025</td><td>7.9 CGPA</td></tr>
<tr><td>XII</td><td>Kendriya Vidyalaya</td><td>CBSE</td><td>2021</td><td>88%</td></tr>
<tr><td>X</td><td>Kendriya Vidyalaya</td><td>CBSE</td><td>2019</td><td>91%</td></tr></table>
<h2>Internship</h2>
<p><b>Data Analyst Intern, XYZ Analytics Pvt. Ltd. (June 2024 - August 2024)</b></p>
<p>- Cleaned and analysed sales data using Python and Excel</p>
<p>- Built Power BI dashboards for the sales team</p>
<h2>Projects</h2>
<p><b>1. Smart Attendance System (Python, OpenCV)</b></p>
<p>Face recognition based attendance with 95% accuracy.</p>
<h2>Skills</h2>
<ul><li>C, C++, Python</li><li>MS Excel, Power BI</li></ul>
<h2>Certifications</h2>
<ul><li>Google Data Analytics Professional Certificate (Coursera)</li><li>NPTEL – Programming in Java (Elite)</li></ul>
<h2>Hobbies</h2><p>Reading, Chess</p>
<h2>Declaration</h2><p>I hereby declare that the above information is true to the best of my knowledge.</p><p>Rahul Kumar Sharma</p>
</body></html>`;

// ---- a tiny .docx (a zip of XML files) with paragraphs, a table and a hyperlink
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = zlib.deflateRawSync(raw), n = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc32(raw), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(raw), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, n, data); central.push(c, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const tr = (...cells) => `<w:tr>${cells.map((c) => `<w:tc>${p(c)}</w:tc>`).join("")}</w:tr>`;
const DOCX = zip({
  "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
  "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>
    ${p("Priya Singh")}
    <w:p><w:r><w:t xml:space="preserve">priya.singh@example.com | +91-91234-56789 | Pune, Maharashtra | </w:t></w:r><w:hyperlink r:id="rId9"><w:r><w:t>LinkedIn</w:t></w:r></w:hyperlink></w:p>
    ${p("SUMMARY")}${p("Final-year MCA student who enjoys building data dashboards.")}
    ${p("EDUCATION")}
    <w:tbl>${tr("MCA", "Symbiosis Institute of Computer Studies", "2025", "CGPA 8.1")}${tr("BCA", "Fergusson College", "2023", "78%")}</w:tbl>
    ${p("SKILLS")}${p("SQL, Tableau, Python, Excel")}
    ${p("PROJECTS")}${p("Sales Dashboard | Tableau, SQL")}${p("• Tracked monthly sales for 40 stores")}
  </w:body></w:document>`,
  "word/_rels/document.xml.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.linkedin.com/in/priya-singh-123" TargetMode="External"/></Relationships>',
});

module.exports = { JAKE, FRESHER, DOCX };
