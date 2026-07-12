import os
import json
import csv
import io
from datetime import datetime, date
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Header, Query, Body, Response
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
from pydantic import BaseModel

app = FastAPI(title="AssetFlow Enterprise Asset & Resource Management System")

DATA_FILE = os.path.join(os.path.dirname(__file__), "assetflow_data.json")

# Helpers to load and save data
def load_data() -> Dict[str, Any]:
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error reading JSON: {e}")
    # Fallback default structure
    return {
        "departments": [],
        "categories": [],
        "users": [],
        "assets": [],
        "allocations": [],
        "transfers": [],
        "bookings": [],
        "maintenance_requests": [],
        "audit_cycles": [],
        "notifications": [],
        "activity_logs": []
    }

def save_data(data: Dict[str, Any]):
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Error saving JSON: {e}")
        raise HTTPException(status_code=500, detail=f"Database write failed: {e}")

# Helper for current timestamp
def get_now_str() -> str:
    return datetime.now().isoformat()

# Activity Logging Helper
def log_activity(data: Dict[str, Any], user: Optional[Dict[str, Any]], action: str, details: str):
    log_id = f"log-{int(datetime.now().timestamp() * 1000)}"
    user_email = user["email"] if user else "System"
    user_name = user["name"] if user else "System"
    user_role = user["role"] if user else "System"
    
    log_entry = {
        "id": log_id,
        "user_id": user_email,
        "user_name": user_name,
        "user_role": user_role,
        "action": action,
        "details": details,
        "timestamp": get_now_str()
    }
    data["activity_logs"].append(log_entry)

# Notification Helper
def notify_user(data: Dict[str, Any], user_id: str, notif_type: str, message: str):
    notif_id = f"notif-{int(datetime.now().timestamp() * 1000)}"
    notif = {
        "id": notif_id,
        "user_id": user_id,
        "type": notif_type,
        "message": message,
        "read": False,
        "timestamp": get_now_str()
    }
    data["notifications"].append(notif)

# Authentication Dependency Helper
def get_current_user_from_header(x_user_email: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not x_user_email:
        raise HTTPException(status_code=401, detail="Authentication credentials not provided")
    data = load_data()
    for u in data["users"]:
        if u["email"].lower() == x_user_email.lower():
            if u["status"] != "Active":
                raise HTTPException(status_code=403, detail="Your account is currently inactive")
            return u
    raise HTTPException(status_code=401, detail="Invalid session or user not found")

# Automatically check for overdue return alerts and create notifications
def check_overdue_allocations(data: Dict[str, Any]):
    today_str = date.today().isoformat()
    for alloc in data["allocations"]:
        if alloc["status"] == "Active" and alloc["expected_return_date"]:
            if alloc["expected_return_date"] < today_str:
                # Check if we already notified this overdue recently
                notif_exists = any(
                    n["type"] == "Overdue Return Alert" and 
                    alloc["asset_id"] in n["message"] and
                    n["user_id"] == alloc["holder_id"]
                    for n in data["notifications"]
                )
                if not notif_exists:
                    # Notify the holder
                    notify_user(
                        data, 
                        alloc["holder_id"] if alloc["holder_type"] == "Employee" else alloc["allocated_by"],
                        "Overdue Return Alert",
                        f"Asset {alloc['asset_id']} is overdue! Expected return date was {alloc['expected_return_date']}."
                    )
                    # Notify the Asset Managers
                    for u in data["users"]:
                        if u["role"] in ["Asset Manager", "Admin"]:
                            notify_user(
                                data,
                                u["email"],
                                "Overdue Return Alert",
                                f"Asset {alloc['asset_id']} held by {alloc['holder_id']} is overdue since {alloc['expected_return_date']}."
                            )

# Pydantic Schemas for validation
class LoginRequest(BaseModel):
    email: str
    password: str

class SignupRequest(BaseModel):
    email: str
    name: str
    password: str
    department_id: Optional[str] = None

class DepartmentRequest(BaseModel):
    name: str
    code: str
    department_head_id: Optional[str] = None
    parent_department_id: Optional[str] = None
    status: str = "Active"

class CategoryRequest(BaseModel):
    name: str
    code: str
    specific_fields: Dict[str, str] = {}

class EmployeeRoleRequest(BaseModel):
    role: str

class EmployeeStatusRequest(BaseModel):
    status: str

class AssetRegisterRequest(BaseModel):
    name: str
    category_id: str
    serial_number: str
    acquisition_date: str
    acquisition_cost: float
    condition: str
    location: str
    shared_bookable: bool = False

class AllocateRequest(BaseModel):
    asset_id: str
    holder_type: str  # "Employee" or "Department"
    holder_id: str    # email or dept-id
    expected_return_date: Optional[str] = None

class ReturnRequest(BaseModel):
    check_in_notes: str
    condition: str

class TransferRequestModel(BaseModel):
    asset_id: str
    to_user_id: str

class BookingRequest(BaseModel):
    resource_id: str
    start_time: str  # ISO Format
    end_time: str    # ISO Format

class MaintenanceRequestModel(BaseModel):
    asset_id: str
    description: str
    priority: str  # "Low", "Medium", "High"
    photo_url: Optional[str] = ""

class AssignTechnicianRequest(BaseModel):
    technician_name: str

class AuditCycleRequest(BaseModel):
    name: str
    department_id: Optional[str] = None
    location: Optional[str] = None
    date_start: str
    date_end: str
    auditors: List[str]

class AuditItemVerifyRequest(BaseModel):
    asset_id: str
    status: str  # "Verified", "Missing", "Damaged"
    notes: str = ""

# API ROUTES

# 1. AUTHENTICATION APIs
@app.post("/api/auth/login")
def login(req: LoginRequest):
    data = load_data()
    for u in data["users"]:
        if u["email"].lower() == req.email.lower() and u["password"] == req.password:
            if u["status"] != "Active":
                raise HTTPException(status_code=403, detail="Account is deactivated")
            return u
    raise HTTPException(status_code=400, detail="Invalid email or password")

@app.post("/api/auth/signup")
def signup(req: SignupRequest):
    data = load_data()
    email_lower = req.email.lower()
    
    # Check duplicate email
    for u in data["users"]:
        if u["email"].lower() == email_lower:
            raise HTTPException(status_code=400, detail="Email already registered")
            
    new_user = {
        "email": req.email,
        "name": req.name,
        "password": req.password,
        "department_id": req.department_id,
        "role": "Employee",  # Strict requirement: signup creates Employee account only
        "status": "Active"
    }
    data["users"].append(new_user)
    
    log_activity(data, new_user, "User Signup", f"Registered new employee account for {req.email}")
    notify_user(data, req.email, "Welcome", f"Welcome {req.name} to AssetFlow! Your account is created as an Employee.")
    
    save_data(data)
    return new_user

@app.get("/api/auth/me")
def get_me(x_user_email: Optional[str] = Header(None, alias="X-User-Email")):
    # Header resolution handles it
    if not x_user_email:
        raise HTTPException(status_code=401, detail="Missing X-User-Email header")
    data = load_data()
    for u in data["users"]:
        if u["email"].lower() == x_user_email.lower():
            return u
    raise HTTPException(status_code=401, detail="User session not found")

# 2. ORGANIZATION SETUP APIs (Admin only)
@app.get("/api/departments")
def get_departments():
    data = load_data()
    return data["departments"]

@app.post("/api/departments")
def create_department(req: DepartmentRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can manage departments")
        
    data = load_data()
    # Check duplicate code
    for d in data["departments"]:
        if d["code"].lower() == req.code.lower():
            raise HTTPException(status_code=400, detail=f"Department with code {req.code} already exists")
            
    dept_id = f"dept-{int(datetime.now().timestamp())}"
    new_dept = {
        "id": dept_id,
        "name": req.name,
        "code": req.code,
        "department_head_id": req.department_head_id,
        "parent_department_id": req.parent_department_id,
        "status": req.status
    }
    data["departments"].append(new_dept)
    
    # Audit log
    log_activity(data, user, "Create Department", f"Created department {req.name} ({req.code})")
    
    # Notify Department Head if assigned
    if req.department_head_id:
        notify_user(data, req.department_head_id, "Role Assignment", f"You have been assigned as head of department {req.name}.")
        
    save_data(data)
    return new_dept

@app.put("/api/departments/{dept_id}")
def update_department(dept_id: str, req: DepartmentRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can manage departments")
        
    data = load_data()
    target_dept = None
    for d in data["departments"]:
        if d["id"] == dept_id:
            target_dept = d
            break
            
    if not target_dept:
        raise HTTPException(status_code=404, detail="Department not found")
        
    # Check duplicate code in other departments
    for d in data["departments"]:
        if d["id"] != dept_id and d["code"].lower() == req.code.lower():
            raise HTTPException(status_code=400, detail="Department code already in use")
            
    old_head = target_dept["department_head_id"]
    target_dept["name"] = req.name
    target_dept["code"] = req.code
    target_dept["department_head_id"] = req.department_head_id
    target_dept["parent_department_id"] = req.parent_department_id
    target_dept["status"] = req.status
    
    log_activity(data, user, "Update Department", f"Updated department {req.name} ({req.code})")
    
    if req.department_head_id and req.department_head_id != old_head:
        notify_user(data, req.department_head_id, "Role Assignment", f"You have been assigned as head of department {req.name}.")
        
    save_data(data)
    return target_dept

@app.get("/api/categories")
def get_categories():
    data = load_data()
    return data["categories"]

@app.post("/api/categories")
def create_category(req: CategoryRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can manage categories")
        
    data = load_data()
    for c in data["categories"]:
        if c["code"].lower() == req.code.lower():
            raise HTTPException(status_code=400, detail="Category code already exists")
            
    cat_id = f"cat-{int(datetime.now().timestamp())}"
    new_cat = {
        "id": cat_id,
        "name": req.name,
        "code": req.code,
        "specific_fields": req.specific_fields
    }
    data["categories"].append(new_cat)
    
    log_activity(data, user, "Create Category", f"Created category {req.name} ({req.code})")
    save_data(data)
    return new_cat

@app.put("/api/categories/{cat_id}")
def update_category(cat_id: str, req: CategoryRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can manage categories")
        
    data = load_data()
    target = None
    for c in data["categories"]:
        if c["id"] == cat_id:
            target = c
            break
    if not target:
        raise HTTPException(status_code=404, detail="Category not found")
        
    target["name"] = req.name
    target["code"] = req.code
    target["specific_fields"] = req.specific_fields
    
    log_activity(data, user, "Update Category", f"Updated category {req.name}")
    save_data(data)
    return target

@app.get("/api/employees")
def get_employees(x_user_email: str = Header(None)):
    # All authenticated users can view the employee directory
    get_current_user_from_header(x_user_email)
    data = load_data()
    # Strip passwords for security
    employees = []
    for u in data["users"]:
        emp = u.copy()
        if "password" in emp:
            del emp["password"]
        employees.append(emp)
    return employees

@app.put("/api/employees/{email}/role")
def update_employee_role(email: str, req: EmployeeRoleRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can promote employees or assign roles")
        
    data = load_data()
    target_user = None
    for u in data["users"]:
        if u["email"].lower() == email.lower():
            target_user = u
            break
            
    if not target_user:
        raise HTTPException(status_code=404, detail="Employee not found")
        
    old_role = target_user["role"]
    target_user["role"] = req.role
    
    log_activity(data, user, "Change User Role", f"Promoted/Changed role of {email} from {old_role} to {req.role}")
    notify_user(data, email, "Role Promotion", f"Your system role has been updated to {req.role} by the Administrator.")
    
    save_data(data)
    return {"message": f"Successfully updated role to {req.role}"}

@app.put("/api/employees/{email}/status")
def update_employee_status(email: str, req: EmployeeStatusRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admins can change employee status")
        
    data = load_data()
    target_user = None
    for u in data["users"]:
        if u["email"].lower() == email.lower():
            target_user = u
            break
            
    if not target_user:
        raise HTTPException(status_code=404, detail="Employee not found")
        
    target_user["status"] = req.status
    
    log_activity(data, user, "Change User Status", f"Updated account status of {email} to {req.status}")
    save_data(data)
    return {"message": f"Successfully updated status to {req.status}"}


# 3. ASSET DIRECTORY APIs
@app.get("/api/assets")
def get_assets(
    search: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    shared_bookable: Optional[bool] = Query(None)
):
    data = load_data()
    assets = data["assets"]
    
    filtered = []
    for a in assets:
        # Search criteria
        if search:
            s_low = search.lower()
            tag_match = s_low in a["id"].lower()
            name_match = s_low in a["name"].lower()
            sn_match = s_low in a.get("serial_number", "").lower()
            loc_match = s_low in a.get("location", "").lower()
            if not (tag_match or name_match or sn_match or loc_match):
                continue
                
        # Category filter
        if category_id and a["category_id"] != category_id:
            continue
            
        # Status filter
        if status and a["status"] != status:
            continue
            
        # Location filter
        if location and location.lower() not in a["location"].lower():
            continue
            
        # Shared Bookable filter
        if shared_bookable is not None and a["shared_bookable"] != shared_bookable:
            continue
            
        filtered.append(a)
        
    return filtered

@app.post("/api/assets")
def register_asset(req: AssetRegisterRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] not in ["Admin", "Asset Manager"]:
        raise HTTPException(status_code=403, detail="Only Admins or Asset Managers can register new assets")
        
    data = load_data()
    
    # Auto-generate Asset Tag (AF-XXXX)
    highest_num = 0
    for a in data["assets"]:
        tag = a["id"]
        if tag.startswith("AF-"):
            try:
                num = int(tag.split("-")[1])
                if num > highest_num:
                    highest_num = num
            except ValueError:
                pass
    next_tag = f"AF-{str(highest_num + 1).zfill(4)}"
    
    new_asset = {
        "id": next_tag,
        "name": req.name,
        "category_id": req.category_id,
        "serial_number": req.serial_number,
        "acquisition_date": req.acquisition_date,
        "acquisition_cost": req.acquisition_cost,
        "condition": req.condition,
        "location": req.location,
        "shared_bookable": req.shared_bookable,
        "status": "Available",
        "current_holder_type": None,
        "current_holder_id": None,
        "expected_return_date": None
    }
    
    data["assets"].append(new_asset)
    log_activity(data, user, "Register Asset", f"Registered new asset {new_asset['name']} as tag {next_tag}")
    save_data(data)
    
    return new_asset

@app.get("/api/assets/{asset_id}")
def get_asset_details(asset_id: str):
    data = load_data()
    asset = None
    for a in data["assets"]:
        if a["id"] == asset_id:
            asset = a
            break
            
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
        
    # Gather allocation history
    alloc_history = [
        alloc for alloc in data["allocations"] 
        if alloc["asset_id"] == asset_id
    ]
    # Gather maintenance history
    maint_history = [
        m for m in data["maintenance_requests"]
        if m["asset_id"] == asset_id
    ]
    
    return {
        "asset": asset,
        "allocation_history": alloc_history,
        "maintenance_history": maint_history
    }


# 4. ASSET ALLOCATION & RETURN APIs
@app.post("/api/allocations")
def allocate_asset(req: AllocateRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] not in ["Admin", "Asset Manager"]:
        raise HTTPException(status_code=403, detail="Only Admins or Asset Managers can allocate assets")
        
    data = load_data()
    
    # Find asset
    asset = None
    for a in data["assets"]:
        if a["id"] == req.asset_id:
            asset = a
            break
            
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
        
    # Check if asset is available
    if asset["status"] != "Available":
        # Check who holds it to report conflict
        holder_name = "Unknown"
        holder_id = asset["current_holder_id"]
        
        if asset["current_holder_type"] == "Employee":
            for u in data["users"]:
                if u["email"].lower() == holder_id.lower():
                    holder_name = u["name"]
                    break
        elif asset["current_holder_type"] == "Department":
            for d in data["departments"]:
                if d["id"] == holder_id:
                    holder_name = f"Department: {d['name']}"
                    break
                    
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"Conflict: Asset is currently held by {holder_name} ({holder_id}).",
                "holder_id": holder_id,
                "holder_name": holder_name
            }
        )
        
    # Perform Allocation
    asset["status"] = "Allocated"
    asset["current_holder_type"] = req.holder_type
    asset["current_holder_id"] = req.holder_id
    asset["expected_return_date"] = req.expected_return_date
    
    alloc_id = f"alloc-{int(datetime.now().timestamp())}"
    new_alloc = {
        "id": alloc_id,
        "asset_id": req.asset_id,
        "holder_type": req.holder_type,
        "holder_id": req.holder_id,
        "allocated_by": user["email"],
        "allocated_date": date.today().isoformat(),
        "expected_return_date": req.expected_return_date,
        "actual_return_date": None,
        "check_in_notes": None,
        "status": "Active"
    }
    data["allocations"].append(new_alloc)
    
    log_activity(data, user, "Allocate Asset", f"Allocated asset {req.asset_id} to {req.holder_type} {req.holder_id}")
    
    # Notify new holder
    if req.holder_type == "Employee":
        notify_user(data, req.holder_id, "Asset Assigned", f"Asset {asset['name']} ({req.asset_id}) has been allocated to you. Expected return: {req.expected_return_date or 'No date set'}.")
    elif req.holder_type == "Department":
        # Notify Department Head
        dept_head_id = None
        for d in data["departments"]:
            if d["id"] == req.holder_id:
                dept_head_id = d["department_head_id"]
                break
        if dept_head_id:
            notify_user(data, dept_head_id, "Asset Assigned", f"Asset {asset['name']} ({req.asset_id}) has been allocated to your department.")
            
    save_data(data)
    return new_alloc

@app.post("/api/allocations/{asset_id}/return")
def return_asset(asset_id: str, req: ReturnRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] not in ["Admin", "Asset Manager"]:
        raise HTTPException(status_code=403, detail="Only Admins or Asset Managers can approve returns and record check-ins")
        
    data = load_data()
    
    # Find asset
    asset = None
    for a in data["assets"]:
        if a["id"] == asset_id:
            asset = a
            break
            
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
        
    # Find active allocation
    active_alloc = None
    for alloc in data["allocations"]:
        if alloc["asset_id"] == asset_id and alloc["status"] == "Active":
            active_alloc = alloc
            break
            
    if not active_alloc:
        raise HTTPException(status_code=400, detail="No active allocation found for this asset")
        
    # Return allocation
    active_alloc["status"] = "Returned"
    active_alloc["actual_return_date"] = date.today().isoformat()
    active_alloc["check_in_notes"] = req.check_in_notes
    
    # Restore asset state
    old_holder = asset["current_holder_id"]
    asset["status"] = "Available"
    asset["current_holder_type"] = None
    asset["current_holder_id"] = None
    asset["expected_return_date"] = None
    asset["condition"] = req.condition
    
    log_activity(data, user, "Return Asset", f"Approved return of asset {asset_id} from {old_holder}. Condition: {req.condition}")
    
    if active_alloc["holder_type"] == "Employee":
        notify_user(data, old_holder, "Return Approved", f"Return of asset {asset_id} has been processed. Condition check notes: {req.check_in_notes}")
        
    save_data(data)
    return {"message": "Asset returned successfully"}

@app.get("/api/transfers")
def get_transfers(x_user_email: str = Header(None)):
    get_current_user_from_header(x_user_email)
    data = load_data()
    return data["transfers"]

@app.post("/api/transfers/request")
def request_transfer(req: TransferRequestModel, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    
    data = load_data()
    # Find asset
    asset = None
    for a in data["assets"]:
        if a["id"] == req.asset_id:
            asset = a
            break
            
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
        
    if asset["status"] != "Allocated":
        raise HTTPException(status_code=400, detail="Transfer can only be requested for allocated assets")
        
    # Check current holder
    from_user = asset["current_holder_id"]
    if asset["current_holder_type"] != "Employee":
        raise HTTPException(status_code=400, detail="Direct department-held transfers must be routed via Asset Manager release")
        
    transfer_id = f"trans-{int(datetime.now().timestamp())}"
    new_transfer = {
        "id": transfer_id,
        "asset_id": req.asset_id,
        "from_user_id": from_user,
        "to_user_id": req.to_user_id,
        "requested_by": user["email"],
        "status": "Requested",
        "date_requested": date.today().isoformat(),
        "approved_by": None,
        "date_processed": None
    }
    data["transfers"].append(new_transfer)
    
    log_activity(data, user, "Request Transfer", f"Requested transfer of asset {req.asset_id} from {from_user} to {req.to_user_id}")
    
    # Notify target and asset manager
    notify_user(data, req.to_user_id, "Transfer Request", f"Transfer of asset {req.asset_id} to you has been requested by {user['name']}.")
    
    # Notify Department heads or Asset Manager
    for u in data["users"]:
        if u["role"] in ["Asset Manager", "Admin"]:
            notify_user(data, u["email"], "Transfer Request Pending", f"Transfer request {transfer_id} is pending approval.")
            
    save_data(data)
    return new_transfer

@app.post("/api/transfers/{transfer_id}/approve")
def approve_transfer(transfer_id: str, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    
    data = load_data()
    transfer = None
    for t in data["transfers"]:
        if t["id"] == transfer_id:
            transfer = t
            break
            
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer request not found")
        
    if transfer["status"] != "Requested":
        raise HTTPException(status_code=400, detail="Transfer has already been processed")
        
    # Check approval permissions: Asset Manager/Admin can approve all. Department Head can approve if current holder is in their dept.
    is_authorized = False
    if user["role"] in ["Admin", "Asset Manager"]:
        is_authorized = True
    elif user["role"] == "Department Head":
        # Find current holder dept
        holder_dept = None
        for u in data["users"]:
            if u["email"].lower() == transfer["from_user_id"].lower():
                holder_dept = u["department_id"]
                break
        # Compare with Dept Head's department
        for d in data["departments"]:
            if d["id"] == holder_dept and d["department_head_id"].lower() == user["email"].lower():
                is_authorized = True
                break
                
    if not is_authorized:
        raise HTTPException(status_code=403, detail="You are not authorized to approve this transfer request")
        
    # Process Transfer:
    # 1. Update old allocation
    active_alloc = None
    for alloc in data["allocations"]:
        if alloc["asset_id"] == transfer["asset_id"] and alloc["status"] == "Active":
            active_alloc = alloc
            break
    if active_alloc:
        active_alloc["status"] = "Transferred"
        active_alloc["actual_return_date"] = date.today().isoformat()
        active_alloc["check_in_notes"] = f"Transferred to {transfer['to_user_id']} via request {transfer_id}"
        
    # 2. Create new allocation
    alloc_id = f"alloc-{int(datetime.now().timestamp())}"
    new_alloc = {
        "id": alloc_id,
        "asset_id": transfer["asset_id"],
        "holder_type": "Employee",
        "holder_id": transfer["to_user_id"],
        "allocated_by": user["email"],
        "allocated_date": date.today().isoformat(),
        "expected_return_date": None,
        "actual_return_date": None,
        "check_in_notes": None,
        "status": "Active"
    }
    data["allocations"].append(new_alloc)
    
    # 3. Update Asset info
    asset = None
    for a in data["assets"]:
        if a["id"] == transfer["asset_id"]:
            asset = a
            break
    if asset:
        asset["current_holder_id"] = transfer["to_user_id"]
        asset["current_holder_type"] = "Employee"
        asset["status"] = "Allocated"
        
    # 4. Update Transfer request status
    transfer["status"] = "Approved"
    transfer["approved_by"] = user["email"]
    transfer["date_processed"] = date.today().isoformat()
    
    log_activity(data, user, "Approve Transfer", f"Approved transfer request {transfer_id} for asset {transfer['asset_id']}")
    
    notify_user(data, transfer["from_user_id"], "Transfer Approved", f"Your asset {transfer['asset_id']} has been transferred to {transfer['to_user_id']}.")
    notify_user(data, transfer["to_user_id"], "Asset Assigned", f"Asset {transfer['asset_id']} has been transferred to you.")
    
    save_data(data)
    return {"message": "Transfer request approved successfully"}

@app.post("/api/transfers/{transfer_id}/reject")
def reject_transfer(transfer_id: str, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    
    data = load_data()
    transfer = None
    for t in data["transfers"]:
        if t["id"] == transfer_id:
            transfer = t
            break
            
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer request not found")
        
    if transfer["status"] != "Requested":
        raise HTTPException(status_code=400, detail="Transfer has already been processed")
        
    # Check permissions
    is_authorized = False
    if user["role"] in ["Admin", "Asset Manager"]:
        is_authorized = True
    elif user["role"] == "Department Head":
        holder_dept = None
        for u in data["users"]:
            if u["email"].lower() == transfer["from_user_id"].lower():
                holder_dept = u["department_id"]
                break
        for d in data["departments"]:
            if d["id"] == holder_dept and d["department_head_id"].lower() == user["email"].lower():
                is_authorized = True
                break
                
    if not is_authorized:
        raise HTTPException(status_code=403, detail="You are not authorized to reject this transfer request")
        
    transfer["status"] = "Rejected"
    transfer["approved_by"] = user["email"]
    transfer["date_processed"] = date.today().isoformat()
    
    log_activity(data, user, "Reject Transfer", f"Rejected transfer request {transfer_id} for asset {transfer['asset_id']}")
    notify_user(data, transfer["requested_by"], "Transfer Rejected", f"Your transfer request for asset {transfer['asset_id']} was rejected.")
    
    save_data(data)
    return {"message": "Transfer request rejected successfully"}


# 5. RESOURCE BOOKING APIs
@app.get("/api/bookings")
def get_bookings(resource_id: Optional[str] = Query(None)):
    data = load_data()
    # Auto update past bookings to 'Completed' if they are ongoing/upcoming and already past
    now_str = get_now_str()
    updated = False
    for b in data["bookings"]:
        if b["status"] == "Upcoming" and b["end_time"] < now_str:
            b["status"] = "Completed"
            updated = True
        elif b["status"] == "Ongoing" and b["end_time"] < now_str:
            b["status"] = "Completed"
            updated = True
        elif b["status"] == "Upcoming" and b["start_time"] <= now_str <= b["end_time"]:
            b["status"] = "Ongoing"
            updated = True
            
    if updated:
        save_data(data)
        
    if resource_id:
        return [b for b in data["bookings"] if b["resource_id"] == resource_id]
    return data["bookings"]

@app.post("/api/bookings")
def create_booking(req: BookingRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    
    data = load_data()
    
    # Verify resource
    asset = None
    for a in data["assets"]:
        if a["id"] == req.resource_id:
            asset = a
            break
            
    if not asset:
        raise HTTPException(status_code=404, detail="Resource not found")
        
    if not asset["shared_bookable"]:
        raise HTTPException(status_code=400, detail="This asset is not marked as a shared bookable resource")
        
    if asset["status"] in ["Under Maintenance", "Retired", "Disposed"]:
        raise HTTPException(status_code=400, detail=f"This resource is currently {asset['status']} and cannot be booked")
        
    # Verify times
    if req.start_time >= req.end_time:
        raise HTTPException(status_code=400, detail="Start time must be before end time")
        
    # Overlap validation: (new_start < existing_end) and (new_end > existing_start)
    for b in data["bookings"]:
        if b["resource_id"] == req.resource_id and b["status"] in ["Upcoming", "Ongoing"]:
            if req.start_time < b["end_time"] and req.end_time > b["start_time"]:
                # Fetch overlap user name
                owner_name = "Another employee"
                for u in data["users"]:
                    if u["email"].lower() == b["user_id"].lower():
                        owner_name = u["name"]
                        break
                raise HTTPException(
                    status_code=400,
                    detail=f"Time slot overlaps with an existing booking by {owner_name} ({b['start_time']} to {b['end_time']})."
                )
                
    # Create Booking
    booking_id = f"book-{int(datetime.now().timestamp())}"
    
    now_str = get_now_str()
    status = "Upcoming"
    if req.start_time <= now_str <= req.end_time:
        status = "Ongoing"
        
    new_booking = {
        "id": booking_id,
        "resource_id": req.resource_id,
        "user_id": user["email"],
        "start_time": req.start_time,
        "end_time": req.end_time,
        "status": status
    }
    data["bookings"].append(new_booking)
    
    log_activity(data, user, "Book Resource", f"Booked {asset['name']} ({req.resource_id}) from {req.start_time} to {req.end_time}")
    notify_user(data, user["email"], "Booking Confirmed", f"Your booking for {asset['name']} has been confirmed for {req.start_time} - {req.end_time}.")
    
    save_data(data)
    return new_booking

@app.post("/api/bookings/{booking_id}/cancel")
def cancel_booking(booking_id: str, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    
    data = load_data()
    booking = None
    for b in data["bookings"]:
        if b["id"] == booking_id:
            booking = b
            break
            
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
        
    # Check authorization
    if booking["user_id"].lower() != user["email"].lower() and user["role"] not in ["Admin", "Asset Manager"]:
        raise HTTPException(status_code=403, detail="You are not authorized to cancel this booking")
        
    if booking["status"] in ["Cancelled", "Completed"]:
        raise HTTPException(status_code=400, detail="Cannot cancel an already completed or cancelled booking")
        
    booking["status"] = "Cancelled"
    
    log_activity(data, user, "Cancel Booking", f"Cancelled booking {booking_id} for resource {booking['resource_id']}")
    notify_user(data, booking["user_id"], "Booking Cancelled", f"Your booking for resource {booking['resource_id']} has been cancelled.")
    
    save_data(data)
    return {"message": "Booking cancelled successfully"}


# 6. MAINTENANCE MANAGEMENT APIs
@app.get("/api/maintenance")
def get_maintenance():
    data = load_data()
    return data["maintenance_requests"]

@app.post("/api/maintenance")
def raise_maintenance_request(req: MaintenanceRequestModel, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    
    data = load_data()
    # Check if asset exists
    asset = None
    for a in data["assets"]:
        if a["id"] == req.asset_id:
            asset = a
            break
            
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
        
    # Raise Request
    maint_id = f"maint-{int(datetime.now().timestamp())}"
    new_request = {
        "id": maint_id,
        "asset_id": req.asset_id,
        "raised_by": user["email"],
        "description": req.description,
        "priority": req.priority,
        "status": "Pending",
        "technician_name": "",
        "photo_url": req.photo_url or "",
        "created_at": get_now_str(),
        "updated_at": get_now_str()
    }
    
    data["maintenance_requests"].append(new_request)
    log_activity(data, user, "Raise Maintenance", f"Raised maintenance request for asset {req.asset_id} ({req.priority} priority)")
    
    # Notify Asset Manager
    for u in data["users"]:
        if u["role"] in ["Asset Manager", "Admin"]:
            notify_user(data, u["email"], "Maintenance Request Raised", f"New maintenance request {maint_id} raised by {user['name']} for asset {req.asset_id}.")
            
    save_data(data)
    return new_request

@app.post("/api/maintenance/{maint_id}/approve")
def approve_maintenance(maint_id: str, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] not in ["Admin", "Asset Manager"]:
        raise HTTPException(status_code=403, detail="Only Admins or Asset Managers can approve maintenance requests")
        
    data = load_data()
    request = None
    for m in data["maintenance_requests"]:
        if m["id"] == maint_id:
            request = m
            break
            
    if not request:
        raise HTTPException(status_code=404, detail="Maintenance request not found")
        
    if request["status"] != "Pending":
        raise HTTPException(status_code=400, detail="Only pending requests can be approved")
        
    # Check asset exists and change its status
    asset = None
    for a in data["assets"]:
        if a["id"] == request["asset_id"]:
            asset = a
            break
            
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
        
    # Terminate active allocations if any
    for alloc in data["allocations"]:
        if alloc["asset_id"] == asset["id"] and alloc["status"] == "Active":
            alloc["status"] = "Returned"
            alloc["actual_return_date"] = date.today().isoformat()
            alloc["check_in_notes"] = f"Auto-returned: Sent to maintenance ({maint_id})"
            notify_user(data, alloc["holder_id"], "Asset Returned", f"Asset {asset['id']} was auto-checked in because it was sent for maintenance.")
            
    # Transition Asset Status to Under Maintenance
    asset["status"] = "Under Maintenance"
    asset["current_holder_type"] = None
    asset["current_holder_id"] = None
    asset["expected_return_date"] = None
    
    # Update request
    request["status"] = "Approved"
    request["updated_at"] = get_now_str()
    
    log_activity(data, user, "Approve Maintenance", f"Approved maintenance request {maint_id} for asset {request['asset_id']}")
    notify_user(data, request["raised_by"], "Maintenance Approved", f"Your maintenance request for asset {request['asset_id']} has been approved.")
    
    save_data(data)
    return request

@app.post("/api/maintenance/{maint_id}/assign")
def assign_technician(maint_id: str, req: AssignTechnicianRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] not in ["Admin", "Asset Manager"]:
        raise HTTPException(status_code=403, detail="Only Admins or Asset Managers can manage maintenance workflow")
        
    data = load_data()
    request = None
    for m in data["maintenance_requests"]:
        if m["id"] == maint_id:
            request = m
            break
            
    if not request:
        raise HTTPException(status_code=404, detail="Maintenance request not found")
        
    if request["status"] not in ["Approved", "Technician Assigned"]:
        raise HTTPException(status_code=400, detail="Workflow status must be Approved before assigning technician")
        
    request["status"] = "Technician Assigned"
    request["technician_name"] = req.technician_name
    request["updated_at"] = get_now_str()
    
    save_data(data)
    return request

@app.post("/api/maintenance/{maint_id}/start")
def start_maintenance(maint_id: str, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] not in ["Admin", "Asset Manager"]:
        raise HTTPException(status_code=403, detail="Only Admins or Asset Managers can manage maintenance workflow")
        
    data = load_data()
    request = None
    for m in data["maintenance_requests"]:
        if m["id"] == maint_id:
            request = m
            break
            
    if not request:
        raise HTTPException(status_code=404, detail="Maintenance request not found")
        
    if request["status"] != "Technician Assigned":
        raise HTTPException(status_code=400, detail="Must assign a technician before starting maintenance work")
        
    request["status"] = "In Progress"
    request["updated_at"] = get_now_str()
    
    save_data(data)
    return request

@app.post("/api/maintenance/{maint_id}/resolve")
def resolve_maintenance(maint_id: str, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] not in ["Admin", "Asset Manager"]:
        raise HTTPException(status_code=403, detail="Only Admins or Asset Managers can resolve maintenance requests")
        
    data = load_data()
    request = None
    for m in data["maintenance_requests"]:
        if m["id"] == maint_id:
            request = m
            break
            
    if not request:
        raise HTTPException(status_code=404, detail="Maintenance request not found")
        
    if request["status"] != "In Progress":
        raise HTTPException(status_code=400, detail="Maintenance must be In Progress before resolving")
        
    # Restore asset status to Available
    asset = None
    for a in data["assets"]:
        if a["id"] == request["asset_id"]:
            asset = a
            break
            
    if asset:
        asset["status"] = "Available"
        asset["condition"] = "Good" # Assume standard repaired condition
        
    request["status"] = "Resolved"
    request["updated_at"] = get_now_str()
    
    log_activity(data, user, "Resolve Maintenance", f"Resolved maintenance request {maint_id} for asset {request['asset_id']}")
    notify_user(data, request["raised_by"], "Maintenance Resolved", f"Maintenance for asset {request['asset_id']} has been resolved. Asset is back online.")
    
    save_data(data)
    return request

@app.post("/api/maintenance/{maint_id}/reject")
def reject_maintenance(maint_id: str, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] not in ["Admin", "Asset Manager"]:
        raise HTTPException(status_code=403, detail="Only Admins or Asset Managers can reject maintenance requests")
        
    data = load_data()
    request = None
    for m in data["maintenance_requests"]:
        if m["id"] == maint_id:
            request = m
            break
            
    if not request:
        raise HTTPException(status_code=404, detail="Maintenance request not found")
        
    if request["status"] != "Pending":
        raise HTTPException(status_code=400, detail="Only pending requests can be rejected")
        
    request["status"] = "Rejected"
    request["updated_at"] = get_now_str()
    
    log_activity(data, user, "Reject Maintenance", f"Rejected maintenance request {maint_id} for asset {request['asset_id']}")
    notify_user(data, request["raised_by"], "Maintenance Rejected", f"Your maintenance request for asset {request['asset_id']} was rejected.")
    
    save_data(data)
    return request


# 7. ASSET AUDIT CYCLE APIs
@app.get("/api/audits")
def get_audits():
    data = load_data()
    return data["audit_cycles"]

@app.post("/api/audits")
def create_audit_cycle(req: AuditCycleRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] not in ["Admin", "Asset Manager"]:
        raise HTTPException(status_code=403, detail="Only Admins or Asset Managers can schedule audit cycles")
        
    data = load_data()
    audit_id = f"audit-{int(datetime.now().timestamp())}"
    
    # Pull assets in scope (filter by dept / location)
    scoped_items = []
    for a in data["assets"]:
        # Match department filter
        if req.department_id:
            # Check holder's department
            holder_email = a["current_holder_id"]
            if not holder_email:
                continue
            # Find holder user dept
            holder_dept = None
            for u in data["users"]:
                if u["email"].lower() == holder_email.lower():
                    holder_dept = u["department_id"]
                    break
            if holder_dept != req.department_id:
                continue
                
        # Match location filter
        if req.location and req.location.lower() not in a["location"].lower():
            continue
            
        scoped_items.append({
            "asset_id": a["id"],
            "status": "Pending",
            "notes": ""
        })
        
    if not scoped_items:
        raise HTTPException(status_code=400, detail="No assets found matching the specified audit scope (Department/Location)")
        
    new_cycle = {
        "id": audit_id,
        "name": req.name,
        "department_id": req.department_id,
        "location": req.location,
        "date_start": req.date_start,
        "date_end": req.date_end,
        "auditors": req.auditors,
        "status": "Active",
        "items": scoped_items,
        "discrepancy_report": ""
    }
    
    data["audit_cycles"].append(new_cycle)
    log_activity(data, user, "Create Audit Cycle", f"Created audit cycle {req.name} ({len(scoped_items)} assets scoped)")
    
    # Notify Auditors
    for auditor in req.auditors:
        notify_user(data, auditor, "Audit Assigned", f"You have been assigned as an auditor for cycle '{req.name}'.")
        
    save_data(data)
    return new_cycle

@app.post("/api/audits/{audit_id}/items")
def verify_audit_item(audit_id: str, req: AuditItemVerifyRequest, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    
    data = load_data()
    cycle = None
    for c in data["audit_cycles"]:
        if c["id"] == audit_id:
            cycle = c
            break
            
    if not cycle:
        raise HTTPException(status_code=404, detail="Audit cycle not found")
        
    if cycle["status"] != "Active":
        raise HTTPException(status_code=400, detail="Cannot edit a closed/completed audit cycle")
        
    # Check permissions (must be assigned auditor or Admin)
    if user["role"] != "Admin" and user["email"].lower() not in [a.lower() for a in cycle["auditors"]]:
        raise HTTPException(status_code=403, detail="You are not assigned as an auditor for this cycle")
        
    # Find item
    target_item = None
    for item in cycle["items"]:
        if item["asset_id"] == req.asset_id:
            target_item = item
            break
            
    if not target_item:
        raise HTTPException(status_code=404, detail="Asset is not in the scope of this audit cycle")
        
    target_item["status"] = req.status
    target_item["notes"] = req.notes
    
    save_data(data)
    return target_item

@app.post("/api/audits/{audit_id}/close")
def close_audit_cycle(audit_id: str, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] not in ["Admin", "Asset Manager"]:
        raise HTTPException(status_code=403, detail="Only Admins or Asset Managers can close audit cycles")
        
    data = load_data()
    cycle = None
    for c in data["audit_cycles"]:
        if c["id"] == audit_id:
            cycle = c
            break
            
    if not cycle:
        raise HTTPException(status_code=404, detail="Audit cycle not found")
        
    if cycle["status"] != "Active":
        raise HTTPException(status_code=400, detail="Audit cycle is already closed")
        
    # Check discrepancies and update assets
    missing_count = 0
    damaged_count = 0
    verified_count = 0
    pending_count = 0
    
    details_list = []
    
    for item in cycle["items"]:
        # Find asset
        asset = None
        for a in data["assets"]:
            if a["id"] == item["asset_id"]:
                asset = a
                break
                
        if not asset:
            continue
            
        if item["status"] == "Pending":
            pending_count += 1
        elif item["status"] == "Verified":
            verified_count += 1
        elif item["status"] == "Missing":
            missing_count += 1
            # Update status to Lost
            asset["status"] = "Lost"
            details_list.append(f"Asset {asset['id']} ({asset['name']}) marked MISSING. Set status to Lost.")
            
            # Notify Asset Manager
            for u in data["users"]:
                if u["role"] in ["Asset Manager", "Admin"]:
                    notify_user(data, u["email"], "Audit Discrepancy Flagged", f"Asset {asset['id']} confirmed missing during audit '{cycle['name']}'.")
                    
        elif item["status"] == "Damaged":
            damaged_count += 1
            # Update condition
            asset["condition"] = "Poor"
            details_list.append(f"Asset {asset['id']} ({asset['name']}) marked DAMAGED. Set condition to Poor.")
            
            # Auto trigger alert for maintenance
            for u in data["users"]:
                if u["role"] in ["Asset Manager", "Admin"]:
                    notify_user(data, u["email"], "Audit Discrepancy Flagged", f"Asset {asset['id']} marked damaged during audit '{cycle['name']}'.")
                    
    # Generate discrepancy report
    report_lines = [
        f"Audit Cycle '{cycle['name']}' closed by {user['name']} on {date.today().isoformat()}.",
        f"Summary: Verified: {verified_count}, Damaged: {damaged_count}, Missing: {missing_count}, Un-audited: {pending_count}.",
        "\nDiscrepancies Found:" if (damaged_count + missing_count) > 0 else "\nNo discrepancies found. All items accounted for."
    ]
    report_lines.extend(details_list)
    
    cycle["status"] = "Closed"
    cycle["discrepancy_report"] = "\n".join(report_lines)
    
    log_activity(data, user, "Close Audit Cycle", f"Closed audit cycle {cycle['name']}. Discrepancies: {missing_count} missing, {damaged_count} damaged")
    
    save_data(data)
    return cycle


# 8. REPORTS & ANALYTICS APIs
@app.get("/api/reports/dashboard")
def get_dashboard_reports(x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    data = load_data()
    
    # Run overdue allocation alert check dynamically on dashboard load
    check_overdue_allocations(data)
    
    assets = data["assets"]
    today_str = date.today().isoformat()
    now_str = get_now_str()
    
    available_count = sum(1 for a in assets if a["status"] == "Available")
    allocated_count = sum(1 for a in assets if a["status"] == "Allocated")
    
    # Maintenance Today: Count requests in Approved, Technician Assigned, or In Progress
    maint_today = sum(1 for m in data["maintenance_requests"] if m["status"] in ["Approved", "Technician Assigned", "In Progress"])
    
    # Active Bookings: bookings currently ongoing
    active_bookings = sum(1 for b in data["bookings"] if b["status"] == "Ongoing")
    
    # Pending Transfers: transfers requested
    pending_transfers = sum(1 for t in data["transfers"] if t["status"] == "Requested")
    
    # Overdue Returns list
    overdue_returns = []
    upcoming_returns = []
    
    for alloc in data["allocations"]:
        if alloc["status"] == "Active" and alloc["expected_return_date"]:
            asset_info = next((a for a in assets if a["id"] == alloc["asset_id"]), None)
            holder_name = "Unknown"
            if alloc["holder_type"] == "Employee":
                holder_name = next((u["name"] for u in data["users"] if u["email"].lower() == alloc["holder_id"].lower()), alloc["holder_id"])
            elif alloc["holder_type"] == "Department":
                holder_name = next((f"Dept: {d['name']}" for d in data["departments"] if d["id"] == alloc["holder_id"]), alloc["holder_id"])
                
            item = {
                "allocation_id": alloc["id"],
                "asset_id": alloc["asset_id"],
                "asset_name": asset_info["name"] if asset_info else "Unknown Asset",
                "holder_name": holder_name,
                "expected_return_date": alloc["expected_return_date"],
                "allocated_date": alloc["allocated_date"]
            }
            if alloc["expected_return_date"] < today_str:
                overdue_returns.append(item)
            else:
                upcoming_returns.append(item)
                
    # Personal dashboard filters for normal employees
    personal_assets = []
    personal_bookings = []
    if user["role"] == "Employee":
        # Assets allocated to them
        for a in assets:
            if a["current_holder_type"] == "Employee" and a["current_holder_id"].lower() == user["email"].lower():
                personal_assets.append(a)
        # Bookings made by them
        for b in data["bookings"]:
            if b["user_id"].lower() == user["email"].lower() and b["status"] in ["Upcoming", "Ongoing"]:
                personal_bookings.append(b)
    elif user["role"] == "Department Head":
        # Assets allocated to their department or them
        dept_id = user["department_id"]
        for a in assets:
            if (a["current_holder_type"] == "Department" and a["current_holder_id"] == dept_id) or \
               (a["current_holder_type"] == "Employee" and a["current_holder_id"].lower() == user["email"].lower()):
                personal_assets.append(a)
        # Bookings
        for b in data["bookings"]:
            if b["user_id"].lower() == user["email"].lower() and b["status"] in ["Upcoming", "Ongoing"]:
                personal_bookings.append(b)

    # Get recent notifications
    user_notifs = [n for n in data["notifications"] if n["user_id"].lower() == user["email"].lower()][-8:]
    user_notifs.reverse()
    
    return {
        "kpis": {
            "available_assets": available_count,
            "allocated_assets": allocated_count,
            "maintenance_today": maint_today,
            "active_bookings": active_bookings,
            "pending_transfers": pending_transfers,
            "overdue_returns": len(overdue_returns)
        },
        "overdue_returns": overdue_returns,
        "upcoming_returns": upcoming_returns,
        "personal_assets": personal_assets,
        "personal_bookings": personal_bookings,
        "notifications": user_notifs
    }

@app.get("/api/reports/analytics")
def get_analytics_reports(x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    
    data = load_data()
    assets = data["assets"]
    
    # 1. Asset utilization: Allocated vs Available vs Maintenance vs Lost/Retired
    utilization_stats = {
        "Allocated": sum(1 for a in assets if a["status"] == "Allocated"),
        "Available": sum(1 for a in assets if a["status"] == "Available"),
        "Under Maintenance": sum(1 for a in assets if a["status"] == "Under Maintenance"),
        "Lost": sum(1 for a in assets if a["status"] == "Lost"),
        "Retired/Disposed": sum(1 for a in assets if a["status"] in ["Retired", "Disposed"])
    }
    
    # 2. Maintenance frequency by asset
    maint_freq = {}
    for m in data["maintenance_requests"]:
        asset_id = m["asset_id"]
        # Find asset name
        a_name = asset_id
        for a in assets:
            if a["id"] == asset_id:
                a_name = f"{asset_id} - {a['name']}"
                break
        maint_freq[a_name] = maint_freq.get(a_name, 0) + 1
        
    # Sort and take top 5
    maint_freq_sorted = dict(sorted(maint_freq.items(), key=lambda item: item[1], reverse=True)[:5])
    
    # 3. Department-wise allocation summary
    dept_allocations = {}
    for alloc in data["allocations"]:
        if alloc["status"] == "Active":
            dept_name = "Direct Employee"
            if alloc["holder_type"] == "Department":
                for d in data["departments"]:
                    if d["id"] == alloc["holder_id"]:
                        dept_name = d["name"]
                        break
            elif alloc["holder_type"] == "Employee":
                # Find employee's department
                for u in data["users"]:
                    if u["email"].lower() == alloc["holder_id"].lower():
                        dept_id = u["department_id"]
                        for d in data["departments"]:
                            if d["id"] == dept_id:
                                dept_name = d["name"]
                                break
                        break
            dept_allocations[dept_name] = dept_allocations.get(dept_name, 0) + 1

    # 4. Resource booking heat map (hour-wise booking density)
    booking_heatmap = {
        "09:00 - 10:00": 0,
        "10:00 - 11:00": 0,
        "11:00 - 12:00": 0,
        "12:00 - 13:00": 0,
        "13:00 - 14:00": 0,
        "14:00 - 15:00": 0,
        "15:00 - 16:00": 0,
        "16:00 - 17:00": 0,
        "17:00+": 0
    }
    for b in data["bookings"]:
        if b["status"] != "Cancelled":
            try:
                # Parse start hour
                start_dt = datetime.fromisoformat(b["start_time"])
                hour = start_dt.hour
                if hour == 9:
                    booking_heatmap["09:00 - 10:00"] += 1
                elif hour == 10:
                    booking_heatmap["10:00 - 11:00"] += 1
                elif hour == 11:
                    booking_heatmap["11:00 - 12:00"] += 1
                elif hour == 12:
                    booking_heatmap["12:00 - 13:00"] += 1
                elif hour == 13:
                    booking_heatmap["13:00 - 14:00"] += 1
                elif hour == 14:
                    booking_heatmap["14:00 - 15:00"] += 1
                elif hour == 15:
                    booking_heatmap["15:00 - 16:00"] += 1
                elif hour == 16:
                    booking_heatmap["16:00 - 17:00"] += 1
                elif hour >= 17:
                    booking_heatmap["17:00+"] += 1
            except Exception:
                pass
                
    # 5. Assets nearing retirement (warranty expiring or > 2 years old)
    nearing_retirement = []
    current_year = date.today().year
    for a in assets:
        if a["status"] not in ["Retired", "Disposed"]:
            try:
                acq_date = date.fromisoformat(a["acquisition_date"])
                age_years = current_year - acq_date.year
                if age_years >= 2 or a["condition"] in ["Fair", "Poor"]:
                    nearing_retirement.append({
                        "id": a["id"],
                        "name": a["name"],
                        "condition": a["condition"],
                        "age_years": age_years,
                        "acquisition_date": a["acquisition_date"]
                    })
            except Exception:
                pass

    return {
        "utilization": utilization_stats,
        "maintenance_frequency": maint_freq_sorted,
        "department_allocations": dept_allocations,
        "booking_heatmap": booking_heatmap,
        "nearing_retirement": nearing_retirement
    }

@app.get("/api/reports/export")
def export_assets_csv(x_user_email: str = Header(None)):
    get_current_user_from_header(x_user_email)
    
    data = load_data()
    assets = data["assets"]
    categories = data["categories"]
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Asset Tag", "Asset Name", "Category", "Serial Number", 
        "Acquisition Date", "Acquisition Cost", "Condition", 
        "Location", "Bookable Resource", "Status", "Current Holder"
    ])
    
    for a in assets:
        # Find category name
        cat_name = "Unknown"
        for c in categories:
            if c["id"] == a["category_id"]:
                cat_name = c["name"]
                break
                
        holder = "None"
        if a["current_holder_id"]:
            holder = f"{a['current_holder_type']}: {a['current_holder_id']}"
            
        writer.writerow([
            a["id"], a["name"], cat_name, a.get("serial_number", ""),
            a["acquisition_date"], a["acquisition_cost"], a["condition"],
            a["location"], "Yes" if a["shared_bookable"] else "No",
            a["status"], holder
        ])
        
    csv_data = output.getvalue()
    output.close()
    
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=AssetFlow_Directory_Export.csv"}
    )


# 9. NOTIFICATIONS AND LOGS APIs
@app.get("/api/notifications")
def get_notifications(x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    data = load_data()
    # Return user's notifications
    user_notifs = [n for n in data["notifications"] if n["user_id"].lower() == user["email"].lower()]
    user_notifs.reverse()
    return user_notifs

@app.post("/api/notifications/{notif_id}/read")
def mark_notification_read(notif_id: str, x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    data = load_data()
    for n in data["notifications"]:
        if n["id"] == notif_id and n["user_id"].lower() == user["email"].lower():
            n["read"] = True
            break
    save_data(data)
    return {"message": "Notification marked as read"}

@app.get("/api/activity-logs")
def get_activity_logs(x_user_email: str = Header(None)):
    user = get_current_user_from_header(x_user_email)
    if user["role"] != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin users can view system activity logs")
    data = load_data()
    logs = list(data["activity_logs"])
    logs.reverse()
    return logs


# 10. MOUNT STATIC & WEBROOT ROUTING

static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)

@app.get("/")
def read_root():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return HTMLResponse(content=open(index_path, "r", encoding="utf-8").read())
    return HTMLResponse("<h3>AssetFlow Static dashboard files not found. Please wait while they are created.</h3>")

app.mount("/static", StaticFiles(directory=static_dir), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8080)
