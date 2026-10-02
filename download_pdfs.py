import os
import requests
import time

def download_pdfs(base_url, download_dir):
    """
    Downloads sequentially numbered PDFs from a base URL.
    Stops when it encounters a 404 Not Found error.
    """
    # Create the download directory if it doesn't exist
    os.makedirs(download_dir, exist_ok=True)
    
    print(f"Starting downloads into: {download_dir}")
    
    file_index = 1
    session = requests.Session()
    
    while True:
        # Construct the URL for the current file
        url = base_url.format(file_index)
        file_name = f"{file_index}.pdf"
        file_path = os.path.join(download_dir, file_name)
        
        try:
            print(f"Attempting to download {file_name}...", end=" ", flush=True)
            response = session.get(url, stream=True, timeout=10)
            
            if response.status_code == 200:
                with open(file_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                print("Success")
                file_index += 1
                # Small delay to be polite to the server
                time.sleep(0.5)
                
            elif response.status_code == 404:
                print("Not Found (404). Reached the end of the sequence.")
                break
                
            else:
                print(f"Failed (Status Code: {response.status_code}). Stopping.")
                break
                
        except requests.exceptions.RequestException as e:
            print(f"Error: {e}")
            break
            
    print(f"\nDownload process completed. Downloaded {file_index - 1} files.")

if __name__ == "__main__":
    # The URL pattern with {} where the number should be
    TARGET_URL = "https://indianrailways.gov.in/railwayboard/uploads/directorate/coaching/TAG_2026/{}.pdf"
    
    # Directory to save the downloaded files
    SAVE_DIRECTORY = "downloaded_pdfs"
    
    download_pdfs(TARGET_URL, SAVE_DIRECTORY)
