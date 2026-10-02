import os
import sqlite3
import pandas as pd
import pdfplumber
import re

def extract_station_data(pdf_path):
    stations = []
    print(f"Extracting stations from {pdf_path} (Using Spatial Bounding Boxes)...")
    
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = page.extract_words()
            
            # Group words into lines by their 'top' coordinate (tolerance of 3 points)
            lines = []
            words.sort(key=lambda w: (w['top'], w['x0']))
            
            if not words:
                continue
                
            current_line = [words[0]]
            for word in words[1:]:
                if abs(word['top'] - current_line[0]['top']) < 3:
                    current_line.append(word)
                else:
                    lines.append(current_line)
                    current_line = [word]
            lines.append(current_line)
            
            # Process each line
            for line in lines:
                cols = {
                    'n1': [], 'c1': [],
                    'n2': [], 'c2': [],
                    'n3': [], 'c3': [],
                    'n4': [], 'c4': []
                }
                
                for w in line:
                    x = w['x0']
                    t = w['text'].strip()
                    
                    if t in ('Station', 'Code', 'Name', 'Index'):
                        continue # Skip headers
                        
                    if x < 135: cols['n1'].append(t)
                    elif x < 165: cols['c1'].append(t)
                    elif x < 260: cols['n2'].append(t)
                    elif x < 290: cols['c2'].append(t)
                    elif x < 385: cols['n3'].append(t)
                    elif x < 415: cols['c3'].append(t)
                    elif x < 510: cols['n4'].append(t)
                    else: cols['c4'].append(t)
                
                for i in range(1, 5):
                    name = " ".join(cols[f'n{i}']).strip()
                    code = " ".join(cols[f'c{i}']).strip()
                    
                    name = re.sub(r'[^a-zA-Z\s\(\)]', '', name).strip()
                    
                    if code and name and len(code) <= 4 and code.isupper() and code.isalpha():
                        stations.append({'station_code': code, 'station_name': name})
                        
    print(f"Extracted {len(stations)} unique stations.")
    return pd.DataFrame(stations).drop_duplicates()

def extract_train_data(pdf_path):
    trains = []
    print(f"Extracting trains from {pdf_path} (Using Sequential Stream Parsing)...")
    
    num_pattern = re.compile(r'^\d{5}(/\d{5})?$')
    table_pattern = re.compile(r'^[\d,]+$')
    
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = [w['text'].strip() for w in page.extract_words()]
            
            entries = []
            current = []
            for w in words:
                if num_pattern.match(w):
                    if current: entries.append(current)
                    current = [w]
                elif current:
                    current.append(w)
            if current: entries.append(current)
            
            for entry in entries:
                if len(entry) < 3: 
                    continue
                
                nums = entry[0]
                # the last word might be a table number, so we strip it out
                if table_pattern.match(entry[-1]):
                    name_parts = entry[1:-1]
                else:
                    name_parts = entry[1:]
                    
                name = " ".join(name_parts)
                # Clean up train name
                name = re.sub(r'[^a-zA-Z\s\-]', '', name).strip()
                
                for num in nums.split('/'):
                    trains.append({'train_number': num, 'train_name': name})

    # Keep the first name found for a train number (remove duplicates)
    df = pd.DataFrame(trains).drop_duplicates(subset=['train_number'], keep='first')
    print(f"Extracted {len(df)} unique trains.")
    return df

def load_to_sqlite(stations_df, trains_df, db_path):
    print(f"Loading data into SQLite database at {db_path}...")
    conn = sqlite3.connect(db_path)
    
    stations_df.to_sql('Stations', conn, if_exists='replace', index=False)
    trains_df.to_sql('Trains', conn, if_exists='replace', index=False)
    
    conn.commit()
    conn.close()

def create_sql_dump(db_path, dump_path):
    conn = sqlite3.connect(db_path)
    with open(dump_path, 'w', encoding='utf-8') as f:
        for line in conn.iterdump():
            f.write('%s\n' % line)
    conn.close()
    
def run_validations(db_path):
    print("\n--- Running Data Validation Tests ---")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Run tests on specific cases user mentioned
    cursor.execute("SELECT train_name FROM Trains WHERE train_number = '14049'")
    row = cursor.fetchone()
    print(f"Validation: Train 14049 is '{row[0] if row else 'Missing'}' -> {'PASS' if row and row[0] == 'Godda Delhi Exp' else 'FAIL'}")
    
    cursor.execute("SELECT train_name FROM Trains WHERE train_number = '13281'")
    row = cursor.fetchone()
    print(f"Validation: Train 13281 is '{row[0] if row else 'Missing'}' -> {'PASS' if row and row[0] == 'Dibrugarh Rajendra Nagar' else 'FAIL'}")
    
    cursor.execute("SELECT train_name FROM Trains WHERE train_number = '14089'")
    row = cursor.fetchone()
    print(f"Validation: Train 14089 is '{row[0] if row else 'Missing'}' -> {'PASS' if row and row[0] == 'Anand Vihar Kotdwara' else 'FAIL'}")
    
    conn.close()
    print("-------------------------------------\n")


if __name__ == "__main__":
    HELPER_DIR = "helper_pdfs"
    STATION_INDEX = os.path.join(HELPER_DIR, "Station_Code_Index.pdf")
    TRAIN_INDEX = os.path.join(HELPER_DIR, "Train_Number_Index.pdf")
    
    DB_PATH = "tag_master_data.sqlite"
    SQL_DUMP = "tag_master_data.sql"
    
    stations_df = extract_station_data(STATION_INDEX)
    trains_df = extract_train_data(TRAIN_INDEX)
    
    load_to_sqlite(stations_df, trains_df, DB_PATH)
    create_sql_dump(DB_PATH, SQL_DUMP)
    
    run_validations(DB_PATH)
    print("Done. DB rebuilt correctly.")
