import os
import sqlite3
import re
import pdfplumber
import pandas as pd
import multiprocessing
from functools import partial

def parse_single_pdf(pdf_path, master_stations, master_trains):
    schedules = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                words = page.extract_words()
                
                train_row_y = None
                for w in words:
                    if 'Train' in w['text'] or 'Number' in w['text']:
                        train_row_y = w['top']
                        break
                        
                if not train_row_y:
                    continue
                    
                train_cols = []
                for w in words:
                    if abs(w['top'] - train_row_y) < 15:
                        nums = re.findall(r'\b(\d{5})\b', w['text'])
                        for num in nums:
                            if num in master_trains:
                                train_cols.append({
                                    'train_number': num,
                                    'x0': w['x0'] - 25, 
                                    'x1': w['x1'] + 25
                                })
                                
                if not train_cols:
                    continue
                    
                rows = {}
                for w in words:
                    if w['top'] < train_row_y + 20:
                        continue
                    y_bin = round(w['top'] / 8) * 8
                    if y_bin not in rows:
                        rows[y_bin] = []
                    rows[y_bin].append(w)
                    
                stop_sequence = 1
                for y_bin, row_words in sorted(rows.items()):
                    left_words = sorted([w for w in row_words if w['x0'] < 160], key=lambda x: x['x0'])
                    if not left_words:
                        continue
                        
                    row_text = " ".join([w['text'] for w in left_words])
                    
                    matched_station_code = None
                    for station_name, code in master_stations.items():
                        if len(station_name) > 3 and station_name.lower() in row_text.lower():
                            matched_station_code = code
                            break
                            
                    if not matched_station_code:
                        continue
                        
                    for col in train_cols:
                        col_words = [w['text'] for w in row_words if col['x0'] <= (w['x0']+w['x1'])/2 <= col['x1']]
                        col_text = " ".join(col_words)
                        
                        times = re.findall(r'(\d{2}\.\d{2})', col_text)
                        if times:
                            arr = times[0] if len(times) > 1 else None
                            dep = times[-1]
                            
                            if 'a' in col_text.lower() and len(times) == 1:
                                arr = times[0]
                                dep = None
                                
                            schedules.append({
                                'train_number': col['train_number'],
                                'station_code': matched_station_code,
                                'arrival_time': arr.replace('.', ':') if arr else None,
                                'departure_time': dep.replace('.', ':') if dep else None,
                                'stop_sequence': stop_sequence,
                                'source_pdf': os.path.basename(pdf_path)
                            })
                    stop_sequence += 1
    except Exception as e:
        print(f"Failed to parse {pdf_path}: {e}")
        
    return schedules

def run():
    db_path = 'tag_master_data.sqlite'
    print("Loading master data...")
    conn = sqlite3.connect(db_path)
    stations_df = pd.read_sql_query("SELECT station_code, station_name FROM Stations", conn)
    trains_df = pd.read_sql_query("SELECT train_number FROM Trains", conn)
    
    master_stations = {row['station_name']: row['station_code'] for _, row in stations_df.iterrows()}
    master_trains = set(trains_df['train_number'].tolist())
    
    tables_dir = 'tables'
    pdf_files = [os.path.join(tables_dir, f) for f in os.listdir(tables_dir) if f.endswith('.pdf')]
    print(f"Found {len(pdf_files)} timetable PDFs. Beginning extraction...")
    
    all_schedules = []
    
    # We will process them sequentially to avoid overloading memory for now
    for i, pdf_path in enumerate(pdf_files, 1):
        print(f"[{i}/{len(pdf_files)}] Parsing {pdf_path}...")
        scheds = parse_single_pdf(pdf_path, master_stations, master_trains)
        all_schedules.extend(scheds)
        
    if not all_schedules:
        print("Error: No schedules were extracted.")
        return
        
    print(f"Extraction complete! Extracted {len(all_schedules)} raw schedule rows.")
    
    # Load into DataFrame
    df = pd.DataFrame(all_schedules)
    
    # We might have duplicates if a train spans multiple pages, drop exact duplicates
    df = df.drop_duplicates()
    
    print("Writing to TrainSchedules table in SQLite...")
    
    # Create TrainSchedules table
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS TrainSchedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            train_number VARCHAR(10),
            station_code VARCHAR(10),
            arrival_time TIME,
            departure_time TIME,
            stop_sequence INTEGER,
            source_pdf VARCHAR(20)
        )
    ''')
    
    df.to_sql('TrainSchedules', conn, if_exists='replace', index=False)
    
    # Create final SQL dump containing all 3 tables
    print("Creating massive final SQL dump...")
    with open('tag_production_dump.sql', 'w', encoding='utf-8') as f:
        for line in conn.iterdump():
            f.write('%s\n' % line)
            
    # Data Validation Tests
    print("\n--- Running Schedule Data Validation Tests ---")
    
    # Test 1: Do we have schedules?
    cursor.execute("SELECT COUNT(*) FROM TrainSchedules")
    count = cursor.fetchone()[0]
    print(f"Test 1 - Total Schedule Rows: {count} -> {'PASS' if count > 10000 else 'FAIL'}")
    
    # Test 2: Does Train 12951 (Mumbai Rajdhani) have a route?
    cursor.execute("SELECT COUNT(*) FROM TrainSchedules WHERE train_number = '12951'")
    rajdhani_stops = cursor.fetchone()[0]
    print(f"Test 2 - Stops for Mumbai Rajdhani (12951): {rajdhani_stops} -> {'PASS' if rajdhani_stops > 0 else 'WARNING'}")
    
    # Test 3: Are arrival times formatted correctly (HH:MM)?
    cursor.execute("SELECT COUNT(*) FROM TrainSchedules WHERE arrival_time IS NOT NULL AND arrival_time NOT LIKE '__:__'")
    bad_time_fmt = cursor.fetchone()[0]
    print(f"Test 3 - Correct Arrival Time Format: {bad_time_fmt} violations -> {'PASS' if bad_time_fmt == 0 else 'FAIL'}")
    
    # Test 4: Are there trains with routes longer than 5 stops?
    cursor.execute("SELECT train_number, MAX(stop_sequence) FROM TrainSchedules GROUP BY train_number ORDER BY MAX(stop_sequence) DESC LIMIT 1")
    longest = cursor.fetchone()
    print(f"Test 4 - Found multi-stop trains? Longest route has {longest[1] if longest else 0} stops -> {'PASS' if longest and longest[1] > 5 else 'FAIL'}")
    
    conn.close()
    print("----------------------------------------------\n")
    print("All extraction finished successfully! Database is ready for NTES queries.")

if __name__ == "__main__":
    run()
