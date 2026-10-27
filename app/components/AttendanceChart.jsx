"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

export default function AttendanceChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height: "300px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-outline)", fontSize: "14px" }}>
        Belum ada data kehadiran untuk ditampilkan.
      </div>
    );
  }

  // Format data for chart
  const chartData = data.map(item => {
    const date = item.date ? new Date(item.date) : null;
    return {
      ...item,
      Hadir: item.hadir,
      Izin: item.izin,
      Sakit: item.sakit,
      Cuti: item.cuti,
      Alfa: item.alfa,
      dateLabel: date && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString("id-ID", { day: "2-digit", month: "short" })
        : "—",
    };
  });

  return (
    <div style={{ width: "100%", height: "300px", marginTop: "16px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4efff" />
          <XAxis dataKey="dateLabel" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--color-outline)" }} dy={10} />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--color-outline)" }} dx={-10} />
          <Tooltip 
            cursor={{ fill: "var(--color-surface-container-high)", opacity: 0.4 }}
            contentStyle={{ borderRadius: "10px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", fontSize: "13px" }}
          />
          <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "20px" }} />
          <Bar dataKey="Hadir" stackId="a" fill="var(--color-primary)" radius={[0, 0, 4, 4]} barSize={30} />
          <Bar dataKey="Izin" stackId="a" fill="#eab308" />
          <Bar dataKey="Sakit" stackId="a" fill="#3b82f6" />
          <Bar dataKey="Cuti" stackId="a" fill="#a855f7" />
          <Bar dataKey="Alfa" stackId="a" fill="var(--color-error)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
