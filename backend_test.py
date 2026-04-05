#!/usr/bin/env python3

import requests
import sys
import time
from datetime import datetime

class CoinModalAPITester:
    def __init__(self, base_url="http://localhost:3000"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0

    def run_test(self, name, method, endpoint, expected_status, data=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    print(f"   Response: {response_data}")
                    return success, response_data
                except:
                    print(f"   Response: {response.text[:100]}")
                    return success, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:200]}")
                return success, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_coin_start_endpoint(self):
        """Test /api/coin/start endpoint"""
        success, response = self.run_test(
            "Coin Start API",
            "POST",
            "api/coin/start",
            200,
            data={"test": True}
        )
        return success

    def test_coin_done_endpoint(self):
        """Test /api/coin/done endpoint"""
        success, response = self.run_test(
            "Coin Done API",
            "POST",
            "api/coin/done",
            200
        )
        return success

    def test_portal_page_load(self):
        """Test portal page loads correctly"""
        success, _ = self.run_test(
            "Portal Page Load",
            "GET",
            "portal",
            200
        )
        return success

def main():
    print("=" * 50)
    print("🧪 COIN MODAL API TESTING")
    print("=" * 50)
    
    # Setup
    tester = CoinModalAPITester("http://localhost:3000")
    
    # Test portal page loads
    if not tester.test_portal_page_load():
        print("❌ Portal page failed to load, stopping tests")
        return 1

    # Test coin API endpoints
    coin_start_success = tester.test_coin_start_endpoint()
    coin_done_success = tester.test_coin_done_endpoint()

    # Print results
    print(f"\n📊 RESULTS")
    print(f"Tests passed: {tester.tests_passed}/{tester.tests_run}")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All tests passed!")
        return 0
    else:
        print("❌ Some tests failed!")
        return 1

if __name__ == "__main__":
    sys.exit(main())