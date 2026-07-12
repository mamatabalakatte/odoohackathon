import sys
import os
import json

# Add workspace root to sys.path to import server
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

# Import FastAPI and TestClient
from fastapi.testclient import TestClient

# Mock out the server's DATA_FILE to use a temporary file for tests
import server
TEST_DATA_FILE = os.path.join(os.path.dirname(__file__), "test_assetflow_data.json")
server.DATA_FILE = TEST_DATA_FILE

# Initialize test database
initial_data = {
  "departments": [
    {"id": "dept-1", "name": "IT Infrastructure", "code": "IT-INF", "department_head_id": "priya@test.com", "parent_department_id": None, "status": "Active"}
  ],
  "categories": [
    {"id": "cat-1", "name": "Electronics", "code": "ELEC", "specific_fields": {"warranty_months": "24"}}
  ],
  "users": [
    {"email": "admin@test.com", "name": "System Admin", "password": "pass", "department_id": "dept-1", "role": "Admin", "status": "Active"},
    {"email": "manager@test.com", "name": "Asset Manager", "password": "pass", "department_id": "dept-1", "role": "Asset Manager", "status": "Active"},
    {"email": "priya@test.com", "name": "Priya Sharma", "password": "pass", "department_id": "dept-1", "role": "Employee", "status": "Active"},
    {"email": "raj@test.com", "name": "Raj Patel", "password": "pass", "department_id": "dept-1", "role": "Employee", "status": "Active"}
  ],
  "assets": [
    {"id": "AF-0001", "name": "Laptop A", "category_id": "cat-1", "serial_number": "SN-A", "acquisition_date": "2025-10-15", "acquisition_cost": 1500.0, "condition": "Excellent", "location": "HQ", "shared_bookable": False, "status": "Available", "current_holder_type": None, "current_holder_id": None, "expected_return_date": None},
    {"id": "AF-0002", "name": "Conf Room B", "category_id": "cat-1", "serial_number": "ROOM-B", "acquisition_date": "2025-10-15", "acquisition_cost": 0.0, "condition": "Excellent", "location": "HQ", "shared_bookable": True, "status": "Available", "current_holder_type": None, "current_holder_id": None, "expected_return_date": None}
  ],
  "allocations": [],
  "transfers": [],
  "bookings": [],
  "maintenance_requests": [],
  "audit_cycles": [],
  "notifications": [],
  "activity_logs": []
}

with open(TEST_DATA_FILE, "w") as f:
    json.dump(initial_data, f, indent=2)

client = TestClient(server.app)

def run_tests():
    print("--- Running AssetFlow Backend Tests ---")
    
    # 1. Signup creates Employee only
    print("Test 1: Signup creates Employee account by default...")
    signup_payload = {
        "email": "new.user@test.com",
        "name": "New User",
        "password": "password123",
        "department_id": "dept-1"
    }
    res = client.post("/api/auth/signup", json=signup_payload)
    assert res.status_code == 200, f"Signup failed: {res.text}"
    user_data = res.json()
    assert user_data["role"] == "Employee", "Signup role should be Employee!"
    print("  [Pass] Signup creates Employee.")

    # 2. Promoting role works (Admin only)
    print("Test 2: Promoting role works...")
    promote_res = client.put(
        "/api/employees/new.user@test.com/role", 
        json={"role": "Asset Manager"},
        headers={"X-User-Email": "admin@test.com"}
    )
    assert promote_res.status_code == 200, f"Promotion failed: {promote_res.text}"
    
    # Verify new.user role is updated
    me_res = client.get("/api/auth/me", headers={"X-User-Email": "new.user@test.com"})
    assert me_res.json()["role"] == "Asset Manager", "Role update failed!"
    print("  [Pass] Promoting role works.")

    # 3. Allocating asset conflict check
    print("Test 3: Double allocation prevention...")
    # Allocate to Priya
    alloc_res = client.post(
        "/api/allocations",
        json={
            "asset_id": "AF-0001",
            "holder_type": "Employee",
            "holder_id": "priya@test.com",
            "expected_return_date": "2026-08-30"
        },
        headers={"X-User-Email": "manager@test.com"}
    )
    assert alloc_res.status_code == 200, f"First allocation failed: {alloc_res.text}"
    
    # Try to allocate to Raj (should fail)
    alloc_conflict_res = client.post(
        "/api/allocations",
        json={
            "asset_id": "AF-0001",
            "holder_type": "Employee",
            "holder_id": "raj@test.com"
        },
        headers={"X-User-Email": "manager@test.com"}
    )
    assert alloc_conflict_res.status_code == 400, "Double allocation did not throw conflict!"
    err_detail = alloc_conflict_res.json()["detail"]
    assert "Conflict: Asset is currently held by Priya Sharma" in err_detail["message"], "Incorrect conflict message!"
    print("  [Pass] Double allocation blocked with conflict details.")

    # 4. Resource booking overlap validation
    print("Test 4: Resource booking overlap validation...")
    # Book Conf Room B 14:00 - 15:30
    booking1 = client.post(
        "/api/bookings",
        json={
            "resource_id": "AF-0002",
            "start_time": "2026-07-12T14:00:00",
            "end_time": "2026-07-12T15:30:00"
        },
        headers={"X-User-Email": "priya@test.com"}
    )
    assert booking1.status_code == 200, f"Booking 1 failed: {booking1.text}"
    
    # Book overlap 15:00 - 16:00 (should fail)
    booking_overlap = client.post(
        "/api/bookings",
        json={
            "resource_id": "AF-0002",
            "start_time": "2026-07-12T15:00:00",
            "end_time": "2026-07-12T16:00:00"
        },
        headers={"X-User-Email": "raj@test.com"}
    )
    assert booking_overlap.status_code == 400, "Overlap booking did not throw overlap error!"
    assert "overlaps" in booking_overlap.json()["detail"], "Incorrect overlap error message!"
    
    # Book non-overlap 15:30 - 17:00 (should succeed)
    booking_ok = client.post(
        "/api/bookings",
        json={
            "resource_id": "AF-0002",
            "start_time": "2026-07-12T15:30:00",
            "end_time": "2026-07-12T17:00:00"
        },
        headers={"X-User-Email": "raj@test.com"}
    )
    assert booking_ok.status_code == 200, f"Non-overlapping consecutive booking failed: {booking_ok.text}"
    print("  [Pass] Overlap validation correctly rejects overlaps and allows consecutive blocks.")

    # 5. Maintenance request & approval flips asset status
    print("Test 5: Maintenance workflow asset status changes...")
    # Raise request
    maint_req = client.post(
        "/api/maintenance",
        json={
            "asset_id": "AF-0001",
            "description": "Flickering screen",
            "priority": "Medium"
        },
        headers={"X-User-Email": "priya@test.com"}
    )
    assert maint_req.status_code == 200, f"Raising maintenance failed: {maint_req.text}"
    maint_id = maint_req.json()["id"]
    
    # Approve request
    maint_app = client.post(
        f"/api/maintenance/{maint_id}/approve",
        headers={"X-User-Email": "manager@test.com"}
    )
    assert maint_app.status_code == 200, f"Approve maintenance failed: {maint_app.text}"
    
    # Verify asset is Under Maintenance
    asset_res = client.get("/api/assets/AF-0001")
    assert asset_res.json()["asset"]["status"] == "Under Maintenance", "Asset status did not flip to Under Maintenance!"
    
    # Complete maintenance
    client.post(f"/api/maintenance/{maint_id}/assign", json={"technician_name": "John Fixer"}, headers={"X-User-Email": "manager@test.com"})
    client.post(f"/api/maintenance/{maint_id}/start", headers={"X-User-Email": "manager@test.com"})
    client.post(f"/api/maintenance/{maint_id}/resolve", headers={"X-User-Email": "manager@test.com"})
    
    # Verify asset is Available
    asset_res = client.get("/api/assets/AF-0001")
    assert asset_res.json()["asset"]["status"] == "Available", "Asset status did not revert to Available after resolution!"
    print("  [Pass] Maintenance states successfully update asset status.")

    # 6. Audits - verify item and close updates missing to Lost
    print("Test 6: Audit closure updates missing status to Lost...")
    # Create audit cycle
    audit_cycle = client.post(
        "/api/audits",
        json={
            "name": "Office Audit A",
            "date_start": "2026-07-01",
            "date_end": "2026-07-15",
            "auditors": ["manager@test.com"]
        },
        headers={"X-User-Email": "manager@test.com"}
    )
    assert audit_cycle.status_code == 200, f"Audit cycle creation failed: {audit_cycle.text}"
    audit_id = audit_cycle.json()["id"]
    
    # Verify item: AF-0001 verified, AF-0002 missing
    client.post(
        f"/api/audits/{audit_id}/items",
        json={"asset_id": "AF-0001", "status": "Verified", "notes": "Looks good"},
        headers={"X-User-Email": "manager@test.com"}
    )
    client.post(
        f"/api/audits/{audit_id}/items",
        json={"asset_id": "AF-0002", "status": "Missing", "notes": "Nowhere to be seen"},
        headers={"X-User-Email": "manager@test.com"}
    )
    
    # Close Audit
    close_res = client.post(
        f"/api/audits/{audit_id}/close",
        headers={"X-User-Email": "manager@test.com"}
    )
    assert close_res.status_code == 200, f"Closing audit failed: {close_res.text}"
    
    # Verify AF-0002 is now Lost
    asset2_res = client.get("/api/assets/AF-0002")
    assert asset2_res.json()["asset"]["status"] == "Lost", "Asset did not update status to Lost!"
    print("  [Pass] Closing audit successfully sets missing asset status to Lost.")

    # Clean up test database
    if os.path.exists(TEST_DATA_FILE):
        os.remove(TEST_DATA_FILE)
        
    print("\n--- ALL BACKEND TESTS PASSED ---")

if __name__ == "__main__":
    run_tests()
