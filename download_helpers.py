import os
import re
import requests
from urllib.parse import urljoin, unquote
import time

def download_helpers(html_file, download_dir):
    """
    Parses a local HTML file for PDF links and downloads them into the specified directory.
    """
    # Create the download directory if it doesn't exist
    os.makedirs(download_dir, exist_ok=True)
    
    print(f"Reading {html_file}...")
    try:
        with open(html_file, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"Error: {html_file} not found.")
        return

    # Find all href links ending in .pdf (case insensitive)
    links = re.findall(r'href=[\'"]([^\'"]+\.pdf)[\'"]', content, re.IGNORECASE)
    
    # Remove duplicates to avoid downloading the same file twice
    links = list(set(links))
    print(f"Found {len(links)} unique PDF links to download.")
    
    # Base domain used to resolve relative paths
    base_domain = "https://indianrailways.gov.in"
    session = requests.Session()
    
    success_count = 0
    fail_count = 0
    
    for i, link in enumerate(links, 1):
        # Construct the absolute URL (urljoin handles both relative and absolute links correctly)
        full_url = urljoin(base_domain, link)
        
        # Get filename from the URL and unquote it to decode percent-encoded characters (like %20 to spaces)
        file_name = unquote(full_url.split('/')[-1])
        file_path = os.path.join(download_dir, file_name)
        
        print(f"[{i}/{len(links)}] Downloading: {file_name}")
        
        try:
            response = session.get(full_url, stream=True, timeout=15)
            
            if response.status_code == 200:
                with open(file_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                print("  -> Success")
                success_count += 1
            else:
                print(f"  -> Failed (HTTP {response.status_code})")
                fail_count += 1
                
        except requests.exceptions.RequestException as e:
            print(f"  -> Error: {e}")
            fail_count += 1
            
        # Small delay to be polite to the server
        time.sleep(0.5)
        
    print(f"\nCompleted! Successfully downloaded {success_count} files. {fail_count} failed.")

if __name__ == "__main__":
    HTML_FILE = "pdfs.html"
    SAVE_DIRECTORY = "helper_pdfs"
    
    download_helpers(HTML_FILE, SAVE_DIRECTORY)
