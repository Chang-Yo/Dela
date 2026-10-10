// 端口发现：读 /proc/net/tcp[6] 找监听中的回环与通配地址，再把 socket inode 对回
// /proc/<pid>/fd 拿进程名。只用 /proc，不引入依赖，也不需要 root——别的用户的进程
// 看不到 pid 与名字，端口本身仍然可见（/proc/net/tcp 全局可读）。只绑在特定外网地址
// 上的端口不报：`ssh -L 127.0.0.1` 转发到回环，够不着它们，报了反而是误导。
package main

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// portsLimit 只是防御：一台机器上监听几百个端口时别把响应撑爆。
const portsLimit = 256

type portEntry struct {
	Port    int    `json:"port"`
	PID     int    `json:"pid,omitempty"`
	Process string `json:"process,omitempty"`
}

func (s *server) handlePorts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "只支持 GET")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ports": listeningPorts(s.bound)})
}

// listeningPorts：回环或通配地址上监听的 TCP 端口，按端口号排序；selfPort（helper 自己
// 的监听端口）不报——用户要预览的是别的服务。
func listeningPorts(selfPort int) []portEntry {
	inodeToPort := listenInodes()
	if len(inodeToPort) == 0 {
		return nil
	}
	inodeToPID := inodeOwners()
	byPort := map[int]*portEntry{}
	for inode, port := range inodeToPort {
		if port == selfPort {
			continue
		}
		entry, ok := byPort[port]
		if !ok {
			entry = &portEntry{Port: port}
			byPort[port] = entry
		}
		if entry.PID != 0 {
			continue
		}
		if pid, ok := inodeToPID[inode]; ok {
			entry.PID = pid
			entry.Process = commOf(pid)
		}
	}
	ports := make([]portEntry, 0, len(byPort))
	for _, entry := range byPort {
		ports = append(ports, *entry)
	}
	sort.Slice(ports, func(i, j int) bool { return ports[i].Port < ports[j].Port })
	if len(ports) > portsLimit {
		ports = ports[:portsLimit]
	}
	return ports
}

// listenInodes：/proc/net/tcp 与 tcp6 里 st=0A（LISTEN）的套接字，inode → 本地端口。
// 只收回环与通配地址；inode=0 的行是内核占位，跳过。
func listenInodes() map[string]int {
	loopbacks := map[string]bool{
		"0100007F":                         true, // 127.0.0.1（/proc 按 little-endian 打印）
		"00000000000000000000000001000000": true, // ::1
	}
	result := map[string]int{}
	for _, name := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		body, err := os.ReadFile(name)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(body), "\n")[1:] {
			fields := strings.Fields(line)
			if len(fields) < 4 || fields[3] != "0A" {
				continue
			}
			local := strings.Split(fields[1], ":")
			if len(local) != 2 {
				continue
			}
			address := strings.ToUpper(local[0])
			if !loopbacks[address] && strings.Trim(address, "0") != "" {
				continue
			}
			port, err := strconv.ParseInt(local[1], 16, 32)
			if err != nil || port <= 0 || port > 65535 {
				continue
			}
			result[fields[9]] = int(port)
		}
	}
	return result
}

// inodeOwners：扫 /proc/<pid>/fd 的 socket:[inode] 符号链接。读不动的 pid（别的用户）
// 自然跳过——那部分进程的归属本来就不该假装知道。
func inodeOwners() map[string]int {
	result := map[string]int{}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return result
	}
	const socketPrefix = "socket:["
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		fds, err := os.ReadDir(filepath.Join("/proc", entry.Name(), "fd"))
		if err != nil {
			continue
		}
		for _, fd := range fds {
			link, err := os.Readlink(filepath.Join("/proc", entry.Name(), "fd", fd.Name()))
			if err != nil || !strings.HasPrefix(link, socketPrefix) {
				continue
			}
			inode := strings.TrimSuffix(strings.TrimPrefix(link, socketPrefix), "]")
			if inode != "" && inode != "0" {
				result[inode] = pid
			}
		}
	}
	return result
}

// commOf：进程名（/proc/<pid>/comm，内核截到 15 字节）；读不到就空着。
func commOf(pid int) string {
	body, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "comm"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(body))
}
