const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Inisialisasi Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 1. Database SQLite Otomatis
const db = new sqlite3.Database('./hidroponik.db');
db.run(`CREATE TABLE IF NOT EXISTS sensor_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tds REAL,
    ph REAL,
    water_temp REAL,
    air_temp REAL,
    humidity REAL,
    ai_advice TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// 2. Jalur API buat ESP32 / Simulasi nyetor data sensor (POST) + Analisis LLM
app.post('/api/sensor', async (req, res) => {
    const { tds, ph, water_temp, air_temp, humidity, plant } = req.body;
    const plantName = plant || 'Kangkung';

    let ai_advice = "Sedang menganalisis kondisi air...";

    try {
        // Prompt Engineering khusus Analis Hidroponik
        const prompt = `Kamu adalah sistem pakar dan asisten ahli hidroponik cerdas.
Analisis data sensor tandon hidroponik berikut untuk tanaman ${plantName}:
- Kepekatan Nutrisi (TDS): ${tds} ppm
- Keasaman Air (pH): ${ph}
- Suhu Air Tandon: ${water_temp} °C
- Suhu Udara: ${air_temp} °C
- Kelembaban Udara: ${humidity} %

Berikan kesimpulan singkat (maksimal 2-3 kalimat padat, langsung ke inti tanpa sapaan) mengenai status keamanan air saat ini untuk tanaman ${plantName}, risiko terhadap akar/daun, serta takaran atau tindakan perawatan spesifik yang harus segera dilakukan (misal: tambah nutrisi AB Mix, tambah air baku, atau penyesuaian pH).`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: prompt,
        });

        ai_advice = response.text;
    } catch (err) {
        console.error("Error Gemini API:", err.message);
        ai_advice = `Gagal memanggil AI (Cek API Key/Koneksi). Data terukur: TDS ${tds} ppm, pH ${ph}, Suhu Air ${water_temp}°C.`;
    }

    db.run(
        `INSERT INTO sensor_logs (tds, ph, water_temp, air_temp, humidity, ai_advice) VALUES (?, ?, ?, ?, ?, ?)`,
        [tds, ph, water_temp, air_temp, humidity, ai_advice],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Data & Analisis AI berhasil disimpan!", id: this.lastID, ai_advice });
        }
    );
});

// 3. Jalur API buat Dashboard Web ngambil 20 data terakhir (GET)
app.get('/api/logs', (req, res) => {
    db.all(`SELECT * FROM sensor_logs ORDER BY id DESC LIMIT 20`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 4. Jalur API buat Export seluruh data ke CSV / Excel (GET)
app.get('/api/export', (req, res) => {
    db.all(`SELECT * FROM sensor_logs ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).send("Gagal mengambil data database");

        // Header kolom CSV
        let csv = '\uFEFFID,Waktu,TDS (ppm),pH,Suhu Air (°C),Suhu Udara (°C),Kelembaban (%),Rekomendasi AI\n';

        // Isi baris data
        rows.forEach(r => {
            // Rapikan teks AI agar koma atau enter tidak merusak kolom Excel
            const cleanAdvice = (r.ai_advice || '').replace(/"/g, '""').replace(/\r?\n|\r/g, ' ');
            csv += `${r.id},"${r.created_at}",${r.tds},${r.ph},${r.water_temp},${r.air_temp},${r.humidity},"${cleanAdvice}"\n`;
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="Laporan_Monitoring_Hidroponik.csv"');
        res.send(csv);
    });
});

app.listen(3000, () => {
    console.log('Server Hidroponik + Gemini AI jalan di http://localhost:3000');
});