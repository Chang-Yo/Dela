package main

// 端口发现的回归：起真监听套接字，断言端口被发现、归属对得上、helper 自己的端口被排除。
// 这个包只能在 Linux 编译（syscall 直连 inotify），跑测试同样要在 Linux 里（CI 或 WSL）。

import (
	"net"
	"os"
	"testing"
)

func findPort(ports []portEntry, port int) *portEntry {
	for i := range ports {
		if ports[i].Port == port {
			return &ports[i]
		}
	}
	return nil
}

func TestListeningPortsFindsOwnListener(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听失败：%v", err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port

	ports := listeningPorts(-1)
	entry := findPort(ports, port)
	if entry == nil {
		t.Fatalf("端口 %d 没有被发现（共 %d 个）", port, len(ports))
	}
	if entry.PID != os.Getpid() {
		t.Errorf("pid = %d，期望 %d", entry.PID, os.Getpid())
	}
	if entry.Process == "" {
		t.Error("进程名是空的：/proc/<pid>/comm 没读到")
	}
}

func TestListeningPortsExcludesSelfPort(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听失败：%v", err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port

	ports := listeningPorts(port)
	if findPort(ports, port) != nil {
		t.Errorf("helper 自己的端口 %d 不该出现在清单里", port)
	}
}
