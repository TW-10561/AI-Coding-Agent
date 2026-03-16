package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
)

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
}

type Request struct {
	Action  string `json:"action"`
	ID      string `json:"id"`
	Payload User  `json:"payload"`
}

type Response struct {
	Success bool        `json:"success"`
	Message string      `json:"message"`
	Data     interface{} `json:"data,omitempty"`
}

var (
	mu sync.RWMutex
	users = make(map[string]User)
)

func handler(w http.ResponseWriter, r *http.Request) {
	var req Request
	json.NewDecoder(r.Body).Decode(&req)

	var resp Response

	switch req.Action {
	case "create_user":
		mu.Lock()
		users[req.Payload.ID] = req.Payload
		mu.Unlock()
		resp = Response{Success: true, Message: "User created", Data: req.Payload}
	case "get_user":
		mu.RLock()
		user, exists := users[req.ID]
		mu.RUnlock()
		if exists {
			resp = Response{Success: true, Message: "User found", Data: user}
		} else {
			resp = Response{Success: false, Message: "User not found"}
		}
	case "update_user":
		mu.Lock()
		users[req.Payload.ID] = req.Payload
		mu.Unlock()
		resp = Response{Success: true, Message: "User updated", Data: req.Payload}
	case "delete_user":
		mu.Lock()
		delete(users, req.ID)
		mu.Unlock()
		resp = Response{Success: true, Message: "User deleted"}
	case "list_users":
		mu.RLock()
		all := make([]User, 0, len(users))
		for _, u := range users {
			all = append(all, u)
		}
		mu.RUnlock()
		resp = Response{Success: true, Message: "Users listed", Data: all}
	default:
		resp = Response{Success: false, Message: "Unknown action"}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func main() {
	http.HandleFunc("/", handler)
	log.Fatal(http.ListenAndServe(":8080", nil))
}